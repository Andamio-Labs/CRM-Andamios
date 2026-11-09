import { Inject, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type pg from 'pg';
import { z } from 'zod';
import type { Database, Transaction } from '../../shared/database/database.js';
import { dealEvents, deals, notifications, stageRobotRuns, stageRobots, stages, tasks } from '../../shared/database/schema.js';
import { withTenant } from '../../shared/database/with-tenant.js';
import { DomainEvents } from '../../shared/events/domain-events.js';
import { badRequest } from '../../shared/http/errors.js';
import { RealtimeGateway } from '../../shared/realtime/realtime.gateway.js';
import { DB, PG_POOL } from '../../shared/tokens.js';
import type { AuthContext } from '../identity/infrastructure/http/session.guard.js';
import { NotificationsService } from '../tasks/notifications.service.js';
import { matchesCondition, robotActionSchema, robotConditionSchema, robotTriggerSchema, triggerText } from './domain/robots.js';

export const createRobotSchema = z
  .object({
    pipelineId: z.uuid(),
    stageId: z.uuid().nullable(),
    trigger: robotTriggerSchema,
    condition: robotConditionSchema.default({}),
    action: robotActionSchema,
  })
  .strict()
  .refine((r) => (r.trigger.type === 'won') === (r.stageId === null), 'Los robots "al ganar" van en el embudo; los demás, en una etapa');
export const updateRobotSchema = z.object({ enabled: z.boolean() }).strict();
export const listRobotsSchema = z.object({ pipelineId: z.uuid().optional() });

type Robot = typeof stageRobots.$inferSelect;
type Deal = typeof deals.$inferSelect;
const view = ({ tenantId: _t, ...robot }: Robot) => robot;

/** Lo que pasa después del commit: avisos en vivo, eventos de dominio y tiempo real. */
interface Effects {
  created: (typeof notifications.$inferSelect)[];
  moved: { deal: Deal; stageId: string }[];
  updated: Deal[];
}

/**
 * E07-S04 — Robots por etapa. Disparadores: entra a la etapa, lleva X días, el cliente no responde en X horas,
 * o se gana el negocio. Acciones: avisar, crear tarea, asignar responsable o mover de etapa.
 * Cada robot corre UNA vez por negocio y ocasión (stage_robot_runs con clave única): un barrido repetido
 * o dos workers en paralelo no duplican nada.
 */
@Injectable()
export class RobotsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PG_POOL) private readonly conn: { pool: pg.Pool },
    private readonly events: DomainEvents,
    private readonly notificationsService: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  onModuleInit() {
    this.events.on('deal.stage_changed', async (e) => {
      if (!e.byRobot) await this.onEvent(e.tenantId, e.dealId, (r, deal) => r.trigger.type === 'enter' && r.stageId === deal.stageId, (deal) => `enter:${deal.stageEnteredAt.toISOString()}`);
    });
    this.events.on('deal.won', (e) => this.onEvent(e.tenantId, e.dealId, (r, deal) => r.trigger.type === 'won' && r.pipelineId === deal.pipelineId, (deal) => `won:${deal.closedAt?.toISOString()}`));
  }

  list(auth: AuthContext, pipelineId?: string) {
    return withTenant(this.db, auth.tenantId, async (tx) =>
      (await tx.select().from(stageRobots).where(pipelineId ? eq(stageRobots.pipelineId, pipelineId) : undefined).orderBy(asc(stageRobots.createdAt))).map(view));
  }

  create(auth: AuthContext, input: z.infer<typeof createRobotSchema>) {
    return withTenant(this.db, auth.tenantId, async (tx) => {
      const pipelineStages = await tx.select({ id: stages.id }).from(stages).where(eq(stages.pipelineId, input.pipelineId));
      if (!pipelineStages.length) throw new NotFoundException('El embudo no existe');
      const inPipeline = (id: string) => pipelineStages.some((s) => s.id === id);
      if (input.stageId && !inPipeline(input.stageId)) throw badRequest('La etapa no es de este embudo');
      if (input.action.type === 'move' && (!inPipeline(input.action.stageId) || input.action.stageId === input.stageId)) {
        throw badRequest('Elige otra etapa del mismo embudo para mover el negocio');
      }
      if (input.action.type === 'move' && input.trigger.type === 'won') throw badRequest('Un negocio ganado ya no se mueve de etapa');
      if (input.action.type === 'assign' && !(await this.isMember(tx, auth.tenantId, input.action.userId))) throw badRequest('El responsable no es parte del equipo');
      const [row] = await tx.insert(stageRobots).values({
        tenantId: auth.tenantId, pipelineId: input.pipelineId, stageId: input.stageId,
        trigger: input.trigger, condition: input.condition, action: input.action, createdBy: auth.userId,
      }).returning();
      return view(row!);
    });
  }

  update(auth: AuthContext, id: string, input: z.infer<typeof updateRobotSchema>) {
    return withTenant(this.db, auth.tenantId, async (tx) => {
      if (!z.uuid().safeParse(id).success) throw new NotFoundException();
      const [row] = await tx.update(stageRobots).set({ enabled: input.enabled }).where(eq(stageRobots.id, id)).returning();
      if (!row) throw new NotFoundException();
      return view(row);
    });
  }

  async remove(auth: AuthContext, id: string) {
    await withTenant(this.db, auth.tenantId, async (tx) => {
      if (!z.uuid().safeParse(id).success) throw new NotFoundException();
      const deleted = await tx.delete(stageRobots).where(eq(stageRobots.id, id)).returning({ id: stageRobots.id });
      if (!deleted.length) throw new NotFoundException();
    });
  }

  runs(auth: AuthContext) {
    return withTenant(this.db, auth.tenantId, (tx) => tx
      .select({ id: stageRobotRuns.id, robotId: stageRobotRuns.robotId, dealId: stageRobotRuns.dealId, dealTitle: deals.title, status: stageRobotRuns.status, detail: stageRobotRuns.detail, createdAt: stageRobotRuns.createdAt })
      .from(stageRobotRuns).innerJoin(deals, eq(deals.id, stageRobotRuns.dealId))
      .orderBy(desc(stageRobotRuns.createdAt), desc(stageRobotRuns.id)).limit(100));
  }

  /** Entró a la etapa o se ganó: robots de ese negocio que corresponden al evento. */
  private async onEvent(tenantId: string, dealId: string, applies: (robot: Robot, deal: Deal) => boolean, key: (deal: Deal) => string) {
    const effects = await withTenant(this.db, tenantId, async (tx) => {
      const effects: Effects = { created: [], moved: [], updated: [] };
      const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId));
      if (!deal) return effects;
      const robots = await tx.select().from(stageRobots).where(and(eq(stageRobots.enabled, true), eq(stageRobots.pipelineId, deal.pipelineId))).orderBy(asc(stageRobots.createdAt));
      for (const robot of robots.filter((r) => applies(r, deal))) await this.run(tx, robot, deal, key(deal), effects);
      return effects;
    });
    await this.apply(tenantId, effects);
  }

  /** Barrido periódico: negocios estancados y clientes que no responden. */
  async sweep(now = new Date()) {
    const { rows } = await this.conn.pool.query<{ tenant_id: string }>(`SELECT tenant_id FROM tenants_with_timed_robots()`);
    for (const { tenant_id: tenantId } of rows) {
      const effects = await withTenant(this.db, tenantId, async (tx) => {
        const effects: Effects = { created: [], moved: [], updated: [] };
        const robots = await tx.select().from(stageRobots)
          .where(and(eq(stageRobots.enabled, true), sql`${stageRobots.trigger}->>'type' IN ('stale', 'no_reply')`)).orderBy(asc(stageRobots.createdAt));
        for (const robot of robots) {
          for (const { deal, key } of await this.dueDeals(tx, robot, now)) await this.run(tx, robot, deal, key, effects);
        }
        return effects;
      });
      await this.apply(tenantId, effects);
    }
  }

  private async dueDeals(tx: Transaction, robot: Robot, now: Date): Promise<{ deal: Deal; key: string }[]> {
    const open = and(eq(deals.stageId, robot.stageId!), eq(deals.status, 'open'));
    if (robot.trigger.type === 'stale') {
      const limit = new Date(now.getTime() - robot.trigger.days * 86_400_000);
      const rows = await tx.select().from(deals).where(and(open, sql`${deals.stageEnteredAt} <= ${limit}`)).limit(500);
      return rows.map((deal) => ({ deal, key: `stale:${deal.stageEnteredAt.toISOString()}` }));
    }
    if (robot.trigger.type !== 'no_reply') return [];
    // Nuestro último mensaje al cliente sigue sin respuesta después de X horas. La clave sale de Postgres
    // en texto: la misma ocasión da siempre la misma clave, sin depender de cómo el driver formatea fechas.
    const limit = new Date(now.getTime() - robot.trigger.hours * 3_600_000);
    const { rows } = await tx.execute(sql`
      SELECT d.id, to_char(last_out.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_out
      FROM deals d
      JOIN LATERAL (SELECT max(m.created_at) AS at FROM messages m JOIN conversations c ON c.id = m.conversation_id
                    WHERE c.contact_id = d.contact_id AND m.direction = 'out') last_out ON last_out.at IS NOT NULL
      WHERE d.stage_id = ${robot.stageId} AND d.status = 'open' AND last_out.at <= ${limit}
        AND NOT EXISTS (SELECT 1 FROM messages mi JOIN conversations ci ON ci.id = mi.conversation_id
                        WHERE ci.contact_id = d.contact_id AND mi.direction = 'in' AND mi.created_at > last_out.at)
      LIMIT 500`);
    const found = rows as { id: string; last_out: string }[];
    if (!found.length) return [];
    const list = await tx.select().from(deals).where(inArray(deals.id, found.map((r) => r.id)));
    return list.map((deal) => ({ deal, key: `no_reply:${found.find((r) => r.id === deal.id)!.last_out}` }));
  }

  /** Reclama la ocasión (clave única) y ejecuta en un savepoint: si la acción falla, queda registrado el error. */
  private async run(tx: Transaction, robot: Robot, deal: Deal, key: string, effects: Effects) {
    const [claimed] = await tx.insert(stageRobotRuns)
      .values({ tenantId: robot.tenantId, robotId: robot.id, dealId: deal.id, runKey: key, status: 'ok' })
      .onConflictDoNothing().returning({ id: stageRobotRuns.id });
    if (!claimed) return;
    const finish = (status: 'ok' | 'skipped' | 'error', detail: string) =>
      tx.update(stageRobotRuns).set({ status, detail }).where(eq(stageRobotRuns.id, claimed.id));
    if (!matchesCondition(robot.condition, { value: Number(deal.value), ownerId: deal.ownerId })) return finish('skipped', 'No cumple la condición');
    try {
      const detail = await tx.transaction((sp) => this.act(sp, robot, deal, effects));
      await finish('ok', detail);
    } catch (error) {
      await finish('error', (error as Error).message.slice(0, 300));
    }
  }

  private async act(tx: Transaction, robot: Robot, deal: Deal, effects: Effects): Promise<string> {
    const { action } = robot;
    const [stage] = robot.stageId ? await tx.select({ name: stages.name }).from(stages).where(eq(stages.id, robot.stageId)) : [];
    const what = triggerText(robot.trigger, stage?.name ?? null);
    switch (action.type) {
      case 'notify': {
        const admins = (await tx.execute(sql`SELECT "userId" FROM member WHERE "organizationId" = ${robot.tenantId} AND role IN ('owner', 'admin')`)).rows as { userId: string }[];
        const recipients = action.to === 'owner' && deal.ownerId ? [deal.ownerId] : admins.map((a) => a.userId);
        effects.created.push(...(await this.notificationsService.create(tx, robot.tenantId, recipients, {
          type: 'robot', title: `${deal.title}: ${what}`, body: 'Aviso de un robot del embudo.', link: '/deals',
        })));
        return `Aviso a ${recipients.length} persona(s)`;
      }
      case 'task': {
        await tx.insert(tasks).values({
          tenantId: robot.tenantId, title: action.title, dealId: deal.id, contactId: deal.contactId, assigneeId: deal.ownerId,
          dueAt: new Date(Date.now() + action.dueHours * 3_600_000), remindBeforeMinutes: 0,
        });
        return `Tarea creada: ${action.title}`;
      }
      case 'assign': {
        if (!(await this.isMember(tx, robot.tenantId, action.userId))) throw new Error('El responsable ya no es parte del equipo');
        const [row] = await tx.update(deals).set({ ownerId: action.userId, updatedAt: sql`now()` }).where(eq(deals.id, deal.id)).returning();
        effects.updated.push(row!);
        return 'Responsable asignado';
      }
      case 'move': {
        const [target] = await tx.select({ id: stages.id }).from(stages).where(and(eq(stages.id, action.stageId), eq(stages.pipelineId, deal.pipelineId)));
        if (!target) throw new Error('La etapa destino ya no existe');
        if (deal.status !== 'open' || deal.stageId === target.id) return 'El negocio ya no estaba en la etapa';
        const [bottom] = await tx.select({ value: sql<number>`coalesce(max(${deals.position}), 0)` }).from(deals).where(and(eq(deals.stageId, target.id), eq(deals.status, 'open')));
        const [row] = await tx.update(deals)
          .set({ stageId: target.id, position: Number(bottom?.value ?? 0) + 1024, stageEnteredAt: sql`now()`, updatedAt: sql`now()` })
          .where(eq(deals.id, deal.id)).returning();
        await tx.insert(dealEvents).values({ tenantId: robot.tenantId, dealId: deal.id, type: 'stage_changed', data: { from: deal.stageId, to: target.id, robotId: robot.id }, actorId: null });
        effects.moved.push({ deal: row!, stageId: target.id });
        return 'Negocio movido de etapa';
      }
    }
  }

  private async apply(tenantId: string, effects: Effects) {
    await this.notificationsService.deliver(tenantId, effects.created, true);
    const publish = (event: string, deal: Deal) => this.realtime.publish(tenantId, event, {
      dealId: deal.id, pipelineId: deal.pipelineId, stageId: deal.stageId, position: deal.position, status: deal.status, ownerId: deal.ownerId,
    }, deal.ownerId, deal.ownerId === null);
    for (const deal of effects.updated) publish('deal.updated', deal);
    for (const { deal, stageId } of effects.moved) {
      publish('deal.moved', deal);
      await this.events.emit({ type: 'deal.stage_changed', tenantId, dealId: deal.id, stageId, actorId: null, byRobot: true });
    }
  }

  private async isMember(tx: Transaction, tenantId: string, userId: string) {
    const { rows } = await tx.execute(sql`SELECT 1 FROM member WHERE "organizationId" = ${tenantId} AND "userId" = ${userId}`);
    return rows.length > 0;
  }
}
