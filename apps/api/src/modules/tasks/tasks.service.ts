import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import type pg from 'pg';
import { z } from 'zod';
import type { Database, Transaction } from '../../shared/database/database.js';
import { contacts, conversations, deals, tasks, tenantSettings, whatsappChannels } from '../../shared/database/schema.js';
import { withTenant } from '../../shared/database/with-tenant.js';
import { DB, PG_POOL } from '../../shared/tokens.js';
import type { AuthContext } from '../identity/infrastructure/http/session.guard.js';
import { TenantContext } from '../tenancy/application/tenant-context.js';
import { NotificationsService } from './notifications.service.js';

const fields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable(),
  assigneeId: z.string().max(64).nullable(),
  dueAt: z.iso.datetime({ offset: true }).nullable(),
  remindBeforeMinutes: z.number().int().min(0).max(43_200).nullable(),
};
export const createTaskSchema = z
  .object({ ...fields, dealId: z.uuid().optional(), contactId: z.uuid().optional() })
  .partial({ description: true, assigneeId: true, dueAt: true, remindBeforeMinutes: true })
  .strict()
  .refine((t) => t.dealId || t.contactId, 'La tarea debe estar vinculada a un negocio o a un contacto');
export const updateTaskSchema = z.object({ ...fields, status: z.enum(['open', 'done']) }).partial().strict();
export const listTasksSchema = z.object({
  status: z.enum(['open', 'overdue', 'done', 'all']).default('open'),
  assignment: z.enum(['all', 'mine', 'unassigned']).default('all'),
  dealId: z.uuid().optional(),
  contactId: z.uuid().optional(),
});

type TaskRow = typeof tasks.$inferSelect;
const view = ({ tenantId: _t, ...task }: TaskRow) => task;

/** E06-S01/S02 — Tareas vinculadas, recordatorios y el dashboard "lo que importa ahora". */
@Injectable()
export class TasksService {
  constructor(
    private readonly tenant: TenantContext,
    private readonly notifications: NotificationsService,
    @Inject(DB) private readonly db: Database,
    @Inject(PG_POOL) private readonly conn: { pool: pg.Pool },
  ) {}

  list(auth: AuthContext, query: z.infer<typeof listTasksSchema>) {
    return this.tenant.run(auth, async (tx) => {
      const byStatus: Record<string, SQL | undefined> = {
        open: eq(tasks.status, 'open'),
        overdue: and(eq(tasks.status, 'open'), lt(tasks.dueAt, sql`now()`)),
        done: eq(tasks.status, 'done'),
        all: undefined,
      };
      const byAssignment: Record<string, SQL | undefined> = { all: undefined, mine: eq(tasks.assigneeId, auth.userId), unassigned: isNull(tasks.assigneeId) };
      const rows = await this.scoped(tx)
        .where(and(await this.visible(tx, auth), byStatus[query.status], byAssignment[query.assignment],
          query.dealId ? eq(tasks.dealId, query.dealId) : undefined, query.contactId ? eq(tasks.contactId, query.contactId) : undefined))
        .orderBy(sql`${tasks.dueAt} ASC NULLS LAST`, asc(tasks.createdAt)).limit(200);
      return rows.map(({ task, dealTitle, contactName }) => ({ ...view(task), dealTitle, contactName }));
    });
  }

  create(auth: AuthContext, input: z.infer<typeof createTaskSchema>) {
    return this.tenant.run(auth, async (tx) => {
      let contactId = input.contactId ?? null;
      if (input.dealId) {
        const [deal] = await tx.select({ contactId: deals.contactId }).from(deals).where(and(eq(deals.id, input.dealId), await this.tenant.visibilityFilter(tx, auth, deals.ownerId)));
        if (!deal) throw new NotFoundException('El negocio no existe');
        contactId ??= deal.contactId;
      }
      if (input.contactId) {
        const [contact] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, input.contactId), await this.tenant.visibilityFilter(tx, auth, contacts.ownerId)));
        if (!contact) throw new NotFoundException('El contacto no existe');
      }
      if (input.assigneeId) await this.tenant.assertMember(tx, auth, input.assigneeId);
      const [row] = await tx.insert(tasks).values({
        tenantId: auth.tenantId, title: input.title, description: input.description ?? null, dealId: input.dealId ?? null, contactId,
        assigneeId: input.assigneeId ?? null, dueAt: input.dueAt ? new Date(input.dueAt) : null,
        remindBeforeMinutes: input.remindBeforeMinutes ?? null, createdBy: auth.userId,
      }).returning();
      return view(row!);
    });
  }

  update(auth: AuthContext, id: string, input: z.infer<typeof updateTaskSchema>) {
    return this.tenant.run(auth, async (tx) => {
      await this.findVisible(tx, auth, id);
      if (input.assigneeId) await this.tenant.assertMember(tx, auth, input.assigneeId);
      const { dueAt, status, ...rest } = input;
      const changes: Partial<typeof tasks.$inferInsert> = { ...rest };
      if (dueAt !== undefined) changes.dueAt = dueAt ? new Date(dueAt) : null;
      // Cambió cuándo vence o cuánto antes avisar: el recordatorio vuelve a programarse.
      if (dueAt !== undefined || input.remindBeforeMinutes !== undefined) changes.remindedAt = null;
      if (status) Object.assign(changes, { status, completedAt: status === 'done' ? new Date() : null });
      const [row] = await tx.update(tasks).set(changes).where(eq(tasks.id, id)).returning();
      return view(row!);
    });
  }

  remove(auth: AuthContext, id: string) {
    return this.tenant.run(auth, async (tx) => {
      await this.findVisible(tx, auth, id);
      await tx.delete(tasks).where(eq(tasks.id, id));
    });
  }

  /**
   * E06-S02 — Barrido de recordatorios (cada minuto desde la cola; idempotente).
   * FOR UPDATE SKIP LOCKED: dos workers en paralelo nunca avisan dos veces la misma tarea.
   */
  async sendDueReminders(now = new Date()) {
    const { rows } = await this.conn.pool.query<{ tenant_id: string; task_id: string }>(`SELECT tenant_id, task_id FROM due_task_reminders($1)`, [now]);
    const byTenant = new Map<string, typeof rows>();
    for (const row of rows) byTenant.set(row.tenant_id, [...(byTenant.get(row.tenant_id) ?? []), row]);
    for (const [tenantId, list] of byTenant) {
      const delivered = await withTenant(this.db, tenantId, async (tx) => {
        const out = [];
        const [settings] = await tx.select().from(tenantSettings);
        for (const { task_id } of list) {
          const { rows: locked } = await tx.execute(sql`SELECT id FROM tasks WHERE id = ${task_id} AND reminded_at IS NULL AND status = 'open' FOR UPDATE SKIP LOCKED`);
          if (!locked.length) continue;
          const [task] = await tx.update(tasks).set({ remindedAt: now }).where(eq(tasks.id, task_id)).returning();
          const recipient = task!.assigneeId ?? task!.createdBy;
          if (!recipient) continue;
          const when = task!.dueAt!.toLocaleString(settings!.locale, { timeZone: settings!.timezone, dateStyle: 'medium', timeStyle: 'short' });
          out.push(...(await this.notifications.create(tx, tenantId, [recipient], {
            type: 'task_reminder', title: `Recordatorio: ${task!.title}`, body: `Vence ${when}.`, link: task!.dealId ? `/deals?deal=${task!.dealId}` : '/tasks',
          })));
        }
        return out;
      });
      await this.notifications.deliver(tenantId, delivered, true);
    }
  }

  /** X-07 — "Lo que importa ahora". */
  dashboard(auth: AuthContext) {
    return this.tenant.run(auth, async (tx) => {
      const [settings, visibleTasks, visibleDeals, visibleContacts] = await Promise.all([
        tx.select().from(tenantSettings).then((rows) => rows[0]!),
        this.visible(tx, auth),
        this.tenant.visibilityFilter(tx, auth, deals.ownerId),
        this.tenant.visibilityFilter(tx, auth, contacts.ownerId),
      ]);
      const endOfToday = sql`(date_trunc('day', now() AT TIME ZONE ${settings.timezone}) + interval '1 day') AT TIME ZONE ${settings.timezone}`;
      const noNextStep = and(eq(deals.status, 'open'), visibleDeals, sql`NOT EXISTS (SELECT 1 FROM tasks t WHERE t.deal_id = ${deals.id} AND t.status = 'open')`);
      const [myTasks, overdueRows, withoutNextStepRows, withoutNextStepItems, unreadRows, upcomingTasks, channelRows] = await Promise.all([
        this.scoped(tx)
          .where(and(eq(tasks.status, 'open'), eq(tasks.assigneeId, auth.userId), lt(tasks.dueAt, endOfToday)))
          .orderBy(asc(tasks.dueAt)).limit(20),
        tx.select({ n: sql<number>`count(*)::int` }).from(tasks)
          .leftJoin(deals, eq(deals.id, tasks.dealId)).leftJoin(contacts, eq(contacts.id, tasks.contactId))
          .where(and(eq(tasks.status, 'open'), lt(tasks.dueAt, sql`now()`), visibleTasks)),
        tx.select({ n: sql<number>`count(*)::int` }).from(deals).where(noNextStep),
        tx.select({ id: deals.id, title: deals.title, ownerId: deals.ownerId, createdAt: deals.createdAt })
          .from(deals).where(noNextStep).orderBy(asc(deals.createdAt)).limit(10),
        tx.select({ n: sql<number>`count(*)::int` }).from(conversations)
          .innerJoin(contacts, eq(contacts.id, conversations.contactId))
          .where(and(gt(conversations.unreadCount, 0), visibleContacts ? or(visibleContacts, eq(conversations.assignedTo, auth.userId)) : undefined)),
        tx.select().from(tasks)
          .where(and(eq(tasks.status, 'open'), eq(tasks.assigneeId, auth.userId), isNotNull(tasks.remindBeforeMinutes), gt(tasks.dueAt, sql`now()`)))
          .orderBy(asc(tasks.dueAt)).limit(5),
        tx.select({ id: whatsappChannels.id }).from(whatsappChannels).where(eq(whatsappChannels.status, 'connected')).limit(1),
      ]);
      const myTasksToday = myTasks.map(({ task, dealTitle, contactName }) => ({ ...view(task), dealTitle, contactName }));
      const [overdue] = overdueRows;
      const [withoutNextStep] = withoutNextStepRows;
      const [unread] = unreadRows;
      const [channel] = channelRows;

      return {
        myTasksToday,
        overdueTasks: overdue!.n,
        unreadConversations: unread!.n,
        dealsWithoutNextStep: { count: withoutNextStep!.n, items: withoutNextStepItems },
        upcomingReminders: upcomingTasks.map(view),
        channelConnected: Boolean(channel),
      };
    });
  }

  private scoped(tx: Transaction) {
    return tx.select({ task: tasks, dealTitle: deals.title, contactName: contacts.name })
      .from(tasks).leftJoin(deals, eq(deals.id, tasks.dealId)).leftJoin(contacts, eq(contacts.id, tasks.contactId)).$dynamic();
  }

  /** Vendedor con "solo lo asignado": sus tareas y las de sus negocios o contactos. */
  private async visible(tx: Transaction, auth: AuthContext) {
    if ((await this.tenant.visibility(tx, auth)) !== 'assigned') return undefined;
    return or(eq(tasks.assigneeId, auth.userId), eq(deals.ownerId, auth.userId), eq(contacts.ownerId, auth.userId));
  }

  private async findVisible(tx: Transaction, auth: AuthContext, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    const [row] = await this.scoped(tx).where(and(eq(tasks.id, id), await this.visible(tx, auth)));
    if (!row) throw new NotFoundException();
    return row.task;
  }
}
