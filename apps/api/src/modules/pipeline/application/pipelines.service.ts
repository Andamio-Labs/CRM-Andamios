import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Transaction } from '../../../shared/database/database.js';
import { closeReasons, dealEvents, deals, pipelines, stages } from '../../../shared/database/schema.js';
import { AppError } from '../../../shared/http/app-error.js';
import { badRequest, isForeignKeyViolation } from '../../../shared/http/errors.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { TenantContext } from '../../tenancy/application/tenant-context.js';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color hexadecimal #RRGGBB');
const stageInput = z.object({ name: z.string().trim().min(1).max(60), color: color.optional() }).strict();

export const createPipelineSchema = z
  .object({ name: z.string().trim().min(1).max(80), stages: z.array(stageInput).min(1).max(20).optional() })
  .strict();
export const renamePipelineSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const createStageSchema = stageInput;
export const updateStageSchema = stageInput.partial().strict();
export const stageOrderSchema = z.object({ stageIds: z.array(z.uuid()).min(1).max(20) }).strict();
export const createReasonSchema = z.object({ outcome: z.enum(['won', 'lost']), label: z.string().trim().min(1).max(80) }).strict();
export const updateReasonSchema = z.object({ label: z.string().trim().min(1).max(80), active: z.boolean() }).partial().strict();

const DEFAULT_STAGES = ['Nuevo', 'Contactado', 'Propuesta', 'Negociación'];
const STAGE_COLORS = ['#94a3b8', '#60a5fa', '#f5b700', '#a78bfa', '#34d399', '#f87171'];
const DEFAULT_REASONS = {
  won: ['Precio adecuado', 'Buena atención', 'Recomendación'],
  lost: ['Precio alto', 'Eligió a la competencia', 'No respondió', 'No era el momento'],
};

/** Embudo "Ventas" y motivos de cierre para una empresa nueva (se llama al registrarla). */
export async function seedPipelineDefaults(tx: Transaction, tenantId: string) {
  const [pipeline] = await tx.insert(pipelines).values({ tenantId, name: 'Ventas' }).returning();
  await tx.insert(stages).values(DEFAULT_STAGES.map((name, i) => ({ tenantId, pipelineId: pipeline!.id, name, position: i, color: STAGE_COLORS[i]! })));
  await tx.insert(closeReasons).values(
    (['won', 'lost'] as const).flatMap((outcome) => DEFAULT_REASONS[outcome].map((label) => ({ tenantId, outcome, label }))),
  );
}

/**
 * Negocio creado como efecto de otra acción (primer mensaje de WhatsApp E04-S02, alta de cliente
 * con negocio X-07): en la primera etapa del embudo indicado (o del primero), moneda del tenant.
 */
export async function createSystemDeal(
  tx: Transaction,
  tenantId: string,
  input: { title: string; contactId: string; source: string | null; pipelineId?: string; ownerId?: string | null; actorId?: string | null },
) {
  const { pipelineId, actorId, ...values } = input;
  const [first] = await tx
    .select({ pipelineId: stages.pipelineId, stageId: stages.id })
    .from(stages).innerJoin(pipelines, eq(pipelines.id, stages.pipelineId))
    .where(pipelineId ? eq(pipelines.id, pipelineId) : undefined)
    .orderBy(asc(pipelines.position), asc(pipelines.createdAt), asc(stages.position)).limit(1);
  if (!first) return null;
  const [{ currency, position }] = (await tx.execute(sql`
    SELECT (SELECT currency FROM tenant_settings) AS currency,
           coalesce((SELECT max(position) FROM deals WHERE stage_id = ${first.stageId} AND status = 'open'), 0) + 1024 AS position`)).rows as [{ currency: string; position: number }];
  const [deal] = await tx.insert(deals).values({ tenantId, ...first, ...values, currency, position: Number(position) }).returning();
  await tx.insert(dealEvents).values({ tenantId, dealId: deal!.id, type: 'created', data: { stageId: first.stageId, source: input.source }, actorId: actorId ?? null });
  return deal!;
}

/** E03-S01 — Embudos, etapas y motivos de cierre (E03-S04). */
@Injectable()
export class PipelinesService {
  constructor(private readonly tenant: TenantContext) {}

  list(auth: AuthContext) {
    return this.tenant.run(auth, async (tx) => {
      const rows = await tx.select().from(pipelines).orderBy(asc(pipelines.position), asc(pipelines.createdAt));
      const allStages = await tx.select().from(stages).orderBy(asc(stages.position));
      return rows.map((p) => ({ ...p, stages: allStages.filter((s) => s.pipelineId === p.id) }));
    });
  }

  create(auth: AuthContext, input: z.infer<typeof createPipelineSchema>) {
    return this.tenant.run(auth, async (tx) => {
      const [{ count }] = (await tx.execute(sql`SELECT count(*)::int AS count FROM pipelines`)).rows as [{ count: number }];
      const [pipeline] = await tx.insert(pipelines).values({ tenantId: auth.tenantId, name: input.name, position: count }).returning();
      const defs = input.stages ?? [{ name: 'Nuevo' }, { name: 'En proceso' }];
      const created = await tx.insert(stages)
        .values(defs.map((s, i) => ({ tenantId: auth.tenantId, pipelineId: pipeline!.id, name: s.name, color: s.color ?? STAGE_COLORS[i % STAGE_COLORS.length]!, position: i })))
        .returning();
      return { ...pipeline!, stages: created };
    });
  }

  rename(auth: AuthContext, id: string, input: z.infer<typeof renamePipelineSchema>) {
    return this.tenant.run(auth, async (tx) => {
      await this.findPipeline(tx, id);
      const [row] = await tx.update(pipelines).set(input).where(eq(pipelines.id, id)).returning();
      return row!;
    });
  }

  remove(auth: AuthContext, id: string) {
    return this.tenant.run(auth, async (tx) => {
      await this.findPipeline(tx, id);
      const [{ count }] = (await tx.execute(sql`SELECT count(*)::int AS count FROM pipelines`)).rows as [{ count: number }];
      if (count <= 1) throw new AppError(HttpStatus.CONFLICT, 'LAST_PIPELINE', 'Debe quedar al menos un embudo.');
      const [deal] = await tx.select({ id: deals.id }).from(deals).where(eq(deals.pipelineId, id)).limit(1);
      if (deal) throw new AppError(HttpStatus.CONFLICT, 'PIPELINE_HAS_DEALS', 'El embudo tiene negocios: muévelos antes de borrarlo.');
      await tx.delete(pipelines).where(eq(pipelines.id, id));
    });
  }

  addStage(auth: AuthContext, pipelineId: string, input: z.infer<typeof createStageSchema>) {
    return this.tenant.run(auth, async (tx) => {
      await this.findPipeline(tx, pipelineId);
      const [{ next }] = (await tx.execute(sql`SELECT coalesce(max(position) + 1, 0)::int AS next FROM stages WHERE pipeline_id = ${pipelineId}`)).rows as [{ next: number }];
      const [row] = await tx.insert(stages)
        .values({ tenantId: auth.tenantId, pipelineId, name: input.name, color: input.color ?? STAGE_COLORS[next % STAGE_COLORS.length]!, position: next })
        .returning();
      return row!;
    });
  }

  updateStage(auth: AuthContext, id: string, input: z.infer<typeof updateStageSchema>) {
    return this.tenant.run(auth, async (tx) => {
      const [row] = await tx.update(stages).set(input).where(eq(stages.id, uuidOr404(id))).returning();
      if (!row) throw new NotFoundException();
      return row;
    });
  }

  /** Reordenar exige la lista COMPLETA de etapas del embudo: evita órdenes ambiguos. */
  reorderStages(auth: AuthContext, pipelineId: string, { stageIds }: z.infer<typeof stageOrderSchema>) {
    return this.tenant.run(auth, async (tx) => {
      await this.findPipeline(tx, pipelineId);
      const current = await tx.select({ id: stages.id }).from(stages).where(eq(stages.pipelineId, pipelineId));
      const same = current.length === stageIds.length && new Set(stageIds).size === stageIds.length && current.every((s) => stageIds.includes(s.id));
      if (!same) throw badRequest('stageIds debe incluir todas las etapas del embudo, una vez cada una');
      for (const [position, id] of stageIds.entries()) await tx.update(stages).set({ position }).where(eq(stages.id, id));
    });
  }

  removeStage(auth: AuthContext, id: string) {
    return this.tenant.run(auth, async (tx) => {
      const [stage] = await tx.select().from(stages).where(eq(stages.id, uuidOr404(id)));
      if (!stage) throw new NotFoundException();
      const [{ count }] = (await tx.execute(sql`SELECT count(*)::int AS count FROM stages WHERE pipeline_id = ${stage.pipelineId}`)).rows as [{ count: number }];
      if (count <= 1) throw new AppError(HttpStatus.CONFLICT, 'LAST_STAGE', 'El embudo debe tener al menos una etapa.');
      try {
        await tx.delete(stages).where(eq(stages.id, id));
      } catch (error) {
        // La FK con RESTRICT es la última palabra: ni una carrera deja negocios huérfanos.
        if (isForeignKeyViolation(error)) throw new AppError(HttpStatus.CONFLICT, 'STAGE_HAS_DEALS', 'La etapa tiene negocios: muévelos antes de borrarla.');
        throw error;
      }
    });
  }

  listReasons(auth: AuthContext) {
    return this.tenant.run(auth, (tx) => tx.select().from(closeReasons).orderBy(asc(closeReasons.outcome), asc(closeReasons.label)));
  }

  createReason(auth: AuthContext, input: z.infer<typeof createReasonSchema>) {
    return this.tenant.run(auth, async (tx) => (await tx.insert(closeReasons).values({ ...input, tenantId: auth.tenantId }).returning())[0]!);
  }

  updateReason(auth: AuthContext, id: string, input: z.infer<typeof updateReasonSchema>) {
    return this.tenant.run(auth, async (tx) => {
      const [row] = await tx.update(closeReasons).set(input).where(eq(closeReasons.id, uuidOr404(id))).returning();
      if (!row) throw new NotFoundException();
      return row;
    });
  }

  async findPipeline(tx: Transaction, id: string) {
    const [row] = await tx.select().from(pipelines).where(eq(pipelines.id, uuidOr404(id)));
    if (!row) throw new NotFoundException();
    return row;
  }

  /** La etapa debe existir y pertenecer al embudo (la FK no lo verifica: son dos columnas). */
  async stageInPipeline(tx: Transaction, stageId: string, pipelineId: string) {
    if (!z.uuid().safeParse(stageId).success) throw badRequest('Etapa inválida');
    const [row] = await tx.select().from(stages).where(and(eq(stages.id, stageId), eq(stages.pipelineId, pipelineId)));
    if (!row) throw badRequest('La etapa no pertenece a este embudo');
    return row;
  }
}

export function uuidOr404(id: string): string {
  if (!z.uuid().safeParse(id).success) throw new NotFoundException();
  return id;
}
