import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gt, max, min, ne, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Transaction } from '../../../shared/database/database.js';
import { closeReasons, companies, contacts, dealEvents, deals, stages, user } from '../../../shared/database/schema.js';
import { AppError } from '../../../shared/http/app-error.js';
import { badRequest } from '../../../shared/http/errors.js';
import { ContactsService } from '../../contacts/application/contacts.service.js';
import { CustomFieldsService } from '../../contacts/application/custom-fields.service.js';
import { InvalidCustomFieldError, validateCustomFieldValues } from '../../contacts/domain/custom-fields.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { TenantContext } from '../../tenancy/application/tenant-context.js';
import { DomainEvents } from '../../../shared/events/domain-events.js';
import { RealtimeGateway } from '../../../shared/realtime/realtime.gateway.js';
import { normalizedContains } from '../../contacts/domain/filters.js';
import { PipelinesService, uuidOr404 } from './pipelines.service.js';

const isoCurrencies = new Set(Intl.supportedValuesOf('currency'));
const STEP = 1024;

const dealFields = {
  title: z.string().trim().min(1).max(160),
  value: z.number().min(0).max(1e13),
  currency: z.string().toUpperCase().refine((c) => isoCurrencies.has(c), 'Moneda ISO 4217 inválida'),
  probability: z.number().int().min(0).max(100).nullable(),
  expectedCloseDate: z.iso.date().nullable(),
  ownerId: z.string().max(64).nullable(),
  source: z.string().trim().max(60).nullable(),
  contactId: z.uuid().nullable(),
  companyId: z.uuid().nullable(),
  customFields: z.record(z.string(), z.unknown()),
  description: z.string().trim().max(5000).nullable(),
};

export const createDealSchema = z
  .object({ ...dealFields, pipelineId: z.uuid(), stageId: z.uuid().optional() })
  .partial({ value: true, currency: true, probability: true, expectedCloseDate: true, ownerId: true, source: true, contactId: true, companyId: true, customFields: true, description: true })
  .strict();
export const updateDealSchema = z.object(dealFields).partial().strict();
export const moveDealSchema = z.object({ stageId: z.uuid(), afterDealId: z.uuid().nullable().optional() }).strict();
/** X-07 — Buscador y "mis leads" del tablero, y la vista lista. */
export const boardQuerySchema = z.object({ q: z.string().trim().max(100).optional(), mine: z.stringbool().optional() });
export const listDealsSchema = boardQuerySchema.extend({
  pipelineId: z.uuid().optional(),
  status: z.enum(['open', 'won', 'lost', 'all']).default('open'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const closeDealSchema = z
  .object({ outcome: z.enum(['won', 'lost']), reasonId: z.uuid({ error: 'El motivo es obligatorio' }), note: z.string().trim().max(1000).optional() })
  .strict();

type DealRow = typeof deals.$inferSelect;
const view = ({ tenantId: _t, value, ...d }: DealRow) => ({ ...d, value: Number(value) });

/** E03-S02/S03/S04 — Negocios: ficha, movimiento en el tablero y cierre. */
@Injectable()
export class DealsService {
  constructor(
    private readonly tenant: TenantContext,
    private readonly pipelinesService: PipelinesService,
    private readonly contactsService: ContactsService,
    private readonly fields: CustomFieldsService,
    private readonly realtime: RealtimeGateway,
    private readonly domainEvents: DomainEvents,
  ) {}

  async create(auth: AuthContext, input: z.infer<typeof createDealSchema>) {
    const deal = await this.tenant.run(auth, async (tx) => {
      await this.pipelinesService.findPipeline(tx, input.pipelineId);
      const stage = input.stageId
        ? await this.pipelinesService.stageInPipeline(tx, input.stageId, input.pipelineId)
        : (await tx.select().from(stages).where(eq(stages.pipelineId, input.pipelineId)).orderBy(asc(stages.position)).limit(1))[0]!;
      const refs = await this.prepare(tx, auth, input, {});
      const [row] = await tx.insert(deals).values({
        ...refs,
        tenantId: auth.tenantId,
        title: input.title!,
        pipelineId: input.pipelineId,
        stageId: stage.id,
        currency: input.currency ?? (await this.tenant.settings(tx)).currency,
        // Sin indicar responsable, el negocio es de quien lo crea; ownerId: null = explícitamente sin responsable.
        ownerId: input.ownerId === undefined ? auth.userId : refs.ownerId,
        position: await this.bottomOf(tx, stage.id),
      }).returning();
      await this.event(tx, auth, row!.id, 'created', { stageId: stage.id });
      return row!;
    });
    this.publish('deal.created', deal);
    return view(deal);
  }

  get(auth: AuthContext, id: string) {
    return this.tenant.run(auth, async (tx) => {
      const deal = await this.findVisible(tx, auth, id);
      const [contact] = deal.contactId ? await tx.select({ id: contacts.id, name: contacts.name, phone: contacts.phone }).from(contacts).where(eq(contacts.id, deal.contactId)) : [];
      const [company] = deal.companyId ? await tx.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, deal.companyId)) : [];
      return { ...view(deal), contact: contact ?? null, company: company ?? null };
    });
  }

  async update(auth: AuthContext, id: string, input: z.infer<typeof updateDealSchema>) {
    const deal = await this.tenant.run(auth, async (tx) => {
      const current = await this.findVisible(tx, auth, id);
      const changes = await this.prepare(tx, auth, input, current.customFields);
      const [row] = await tx.update(deals).set({ ...changes, updatedAt: sql`now()` }).where(eq(deals.id, id)).returning();
      return row!;
    });
    this.publish('deal.updated', deal);
    return view(deal);
  }

  async remove(auth: AuthContext, id: string) {
    const deal = await this.tenant.run(auth, async (tx) => {
      const current = await this.findVisible(tx, auth, id);
      await tx.delete(deals).where(eq(deals.id, id));
      return current;
    });
    this.publish('deal.deleted', deal);
  }

  /**
   * E03-S02 — Posición fraccional: el negocio queda entre `afterDealId` y el siguiente
   * (null = arriba de todo, omitido = al final). Un lock por columna serializa movimientos simultáneos.
   */
  async move(auth: AuthContext, id: string, { stageId, afterDealId }: z.infer<typeof moveDealSchema>) {
    let stageChanged = false;
    const deal = await this.tenant.run(auth, async (tx) => {
      const current = await this.findVisible(tx, auth, id);
      if (current.status !== 'open') throw new AppError(HttpStatus.CONFLICT, 'DEAL_CLOSED', 'Reabre el negocio para moverlo.');
      await this.pipelinesService.stageInPipeline(tx, stageId, current.pipelineId);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`stage:${stageId}`}))`);

      let position: number;
      if (afterDealId === undefined) position = await this.bottomOf(tx, stageId, id);
      else if (afterDealId === null) position = await this.topOf(tx, stageId, id);
      else position = await this.between(tx, auth, stageId, afterDealId, id);

      const [row] = await tx.update(deals).set({ stageId, position, updatedAt: sql`now()` }).where(eq(deals.id, id)).returning();
      stageChanged = current.stageId !== stageId;
      if (stageChanged) await this.event(tx, auth, id, 'stage_changed', { from: current.stageId, to: stageId });
      return row!;
    });
    this.publish('deal.moved', deal);
    if (stageChanged) await this.domainEvents.emit({ type: 'deal.stage_changed', tenantId: auth.tenantId, dealId: id, stageId, actorId: auth.userId });
    return view(deal);
  }

  /** E03-S04 — Cerrar exige un motivo activo del resultado correcto. */
  async close(auth: AuthContext, id: string, input: z.infer<typeof closeDealSchema>) {
    const deal = await this.tenant.run(auth, async (tx) => {
      const current = await this.findVisible(tx, auth, id);
      if (current.status !== 'open') throw new AppError(HttpStatus.CONFLICT, 'DEAL_ALREADY_CLOSED', 'El negocio ya está cerrado.');
      const [reason] = await tx.select().from(closeReasons).where(eq(closeReasons.id, input.reasonId));
      if (!reason || !reason.active || reason.outcome !== input.outcome) throw badRequest('Motivo de cierre inválido para este resultado');
      const [row] = await tx.update(deals)
        .set({ status: input.outcome, closeReasonId: reason.id, closeNote: input.note ?? null, closedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(deals.id, id)).returning();
      await this.event(tx, auth, id, input.outcome, { reasonId: reason.id, reason: reason.label, note: input.note ?? null, value: Number(current.value) });
      return row!;
    });
    this.publish('deal.closed', deal);
    if (deal.status === 'won') await this.domainEvents.emit({ type: 'deal.won', tenantId: auth.tenantId, dealId: id, actorId: auth.userId });
    return view(deal);
  }

  async reopen(auth: AuthContext, id: string) {
    const deal = await this.tenant.run(auth, async (tx) => {
      const current = await this.findVisible(tx, auth, id);
      if (current.status === 'open') throw new AppError(HttpStatus.CONFLICT, 'DEAL_ALREADY_OPEN', 'El negocio ya está abierto.');
      const [row] = await tx.update(deals)
        .set({ status: 'open', closeReasonId: null, closeNote: null, closedAt: null, position: await this.bottomOf(tx, current.stageId, id), updatedAt: sql`now()` })
        .where(eq(deals.id, id)).returning();
      await this.event(tx, auth, id, 'reopened', { previous: current.status });
      return row!;
    });
    this.publish('deal.moved', deal);
    return view(deal);
  }

  events(auth: AuthContext, id: string) {
    return this.tenant.run(auth, async (tx) => {
      await this.findVisible(tx, auth, id);
      return tx.select({ type: dealEvents.type, data: dealEvents.data, actorId: dealEvents.actorId, createdAt: dealEvents.createdAt })
        .from(dealEvents).where(eq(dealEvents.dealId, id)).orderBy(asc(dealEvents.createdAt), asc(dealEvents.id));
    });
  }

  board(auth: AuthContext, pipelineId: string, query: z.infer<typeof boardQuerySchema> = {}) {
    return this.tenant.run(auth, async (tx) => {
      const pipeline = await this.pipelinesService.findPipeline(tx, pipelineId);
      const columns = await tx.select().from(stages).where(eq(stages.pipelineId, pipelineId)).orderBy(asc(stages.position));
      const open = await this.cards(tx, and(eq(deals.pipelineId, pipelineId), eq(deals.status, 'open'), await this.filters(tx, auth, query)), asc(deals.position), 2000);
      return { pipeline, stages: columns.map((s) => ({ ...s, deals: open.filter((d) => d.stageId === s.id) })) };
    });
  }

  /** X-07 — Vista lista del embudo con los mismos filtros que el tablero. */
  list(auth: AuthContext, query: z.infer<typeof listDealsSchema>) {
    return this.tenant.run(auth, async (tx) => {
      const where = and(
        query.pipelineId ? eq(deals.pipelineId, query.pipelineId) : undefined,
        query.status === 'all' ? undefined : eq(deals.status, query.status),
        await this.filters(tx, auth, query),
      );
      return { items: await this.cards(tx, where, desc(deals.createdAt), query.limit) };
    });
  }

  private async filters(tx: Transaction, auth: AuthContext, { q, mine }: z.infer<typeof boardQuerySchema>) {
    const search = q
      ? or(...[deals.title, deals.description, contacts.name, contacts.phone].map((col) => normalizedContains(sql`${col}`, q)))
      : undefined;
    return and(await this.tenant.visibilityFilter(tx, auth, deals.ownerId), mine ? eq(deals.ownerId, auth.userId) : undefined, search);
  }

  /** Tarjeta completa: contacto, teléfono, responsable, origen, etapa y fecha (referencia, pantalla 4). */
  private async cards(tx: Transaction, where: SQL | undefined, order: SQL, limit: number) {
    const rows = await tx
      .select({ deal: deals, contact: { id: contacts.id, name: contacts.name, phone: contacts.phone }, owner: { id: user.id, name: user.name }, stage: { id: stages.id, name: stages.name } })
      .from(deals)
      .innerJoin(stages, eq(stages.id, deals.stageId))
      .leftJoin(contacts, eq(contacts.id, deals.contactId))
      .leftJoin(user, eq(user.id, deals.ownerId))
      .where(where).orderBy(order).limit(limit);
    return rows.map((r) => ({ ...view(r.deal), contact: r.contact?.id ? r.contact : null, owner: r.owner?.id ? r.owner : null, stage: r.stage }));
  }

  private async findVisible(tx: Transaction, auth: AuthContext, id: string) {
    const [row] = await tx.select().from(deals).where(and(eq(deals.id, uuidOr404(id)), await this.tenant.visibilityFilter(tx, auth, deals.ownerId)));
    if (!row) throw new NotFoundException();
    return row;
  }

  private async prepare(tx: Transaction, auth: AuthContext, input: Partial<z.infer<typeof updateDealSchema>>, currentCustom: Record<string, unknown>) {
    const { customFields, value, ...rest } = input;
    const out: Partial<typeof deals.$inferInsert> = { ...rest };
    if (value !== undefined) out.value = String(value);
    if (input.ownerId) await this.tenant.assertMember(tx, auth, input.ownerId);
    if (input.contactId) await this.contactsService.findVisible(tx, auth, input.contactId);
    if (input.companyId) {
      const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, input.companyId));
      if (!company) throw new NotFoundException('La organización no existe');
    }
    if (customFields && Object.keys(customFields).length) {
      try {
        const merged = { ...currentCustom, ...validateCustomFieldValues(await this.fields.definitions(tx, 'deal'), customFields) };
        out.customFields = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== null)) as typeof out.customFields;
      } catch (error) {
        if (error instanceof InvalidCustomFieldError) throw badRequest(error.message);
        throw error;
      }
    }
    return out;
  }

  private async bottomOf(tx: Transaction, stageId: string, exclude?: string) {
    const [row] = await tx.select({ value: max(deals.position) }).from(deals)
      .where(and(eq(deals.stageId, stageId), eq(deals.status, 'open'), exclude ? ne(deals.id, exclude) : undefined));
    return (row?.value ?? 0) + STEP;
  }

  private async topOf(tx: Transaction, stageId: string, exclude: string) {
    const [row] = await tx.select({ value: min(deals.position) }).from(deals)
      .where(and(eq(deals.stageId, stageId), eq(deals.status, 'open'), ne(deals.id, exclude)));
    return (row?.value ?? STEP) - STEP;
  }

  private async between(tx: Transaction, auth: AuthContext, stageId: string, afterId: string, exclude: string): Promise<number> {
    const after = await this.findVisible(tx, auth, afterId).catch(() => undefined);
    if (!after || after.stageId !== stageId || after.status !== 'open' || after.id === exclude) {
      throw badRequest('afterDealId debe ser otro negocio abierto de la etapa destino');
    }
    const [next] = await tx.select({ position: deals.position }).from(deals)
      .where(and(eq(deals.stageId, stageId), eq(deals.status, 'open'), gt(deals.position, after.position), ne(deals.id, exclude)))
      .orderBy(asc(deals.position)).limit(1);
    if (!next) return after.position + STEP;
    if (next.position - after.position > 1e-6) return (after.position + next.position) / 2;
    // Se agotó la precisión entre dos vecinos: renumeramos la columna y reintentamos.
    await tx.execute(sql`
      UPDATE deals d SET position = r.n * ${STEP}
      FROM (SELECT id, row_number() OVER (ORDER BY position, created_at) AS n FROM deals WHERE stage_id = ${stageId} AND status = 'open') r
      WHERE d.id = r.id`);
    return this.between(tx, auth, stageId, afterId, exclude);
  }

  private async event(tx: Transaction, auth: AuthContext, dealId: string, type: string, data: object) {
    await tx.insert(dealEvents).values({ tenantId: auth.tenantId, dealId, type, data, actorId: auth.userId });
  }

  /** Se emite DESPUÉS del commit: nadie ve en vivo un cambio que luego se revirtió. */
  private publish(event: string, deal: DealRow) {
    this.realtime.publish(deal.tenantId, event, {
      dealId: deal.id, pipelineId: deal.pipelineId, stageId: deal.stageId, position: deal.position, status: deal.status, ownerId: deal.ownerId,
    }, deal.ownerId);
  }
}
