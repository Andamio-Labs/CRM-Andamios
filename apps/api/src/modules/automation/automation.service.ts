import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import { z } from 'zod';
import type { Database, Transaction } from '../../shared/database/database.js';
import { type AutomationRule, automationRules, automationRuns, contacts, conversations, deals, tasks } from '../../shared/database/schema.js';
import { withTenant } from '../../shared/database/with-tenant.js';
import { DomainEvents } from '../../shared/events/domain-events.js';
import { badRequest } from '../../shared/http/errors.js';
import { DB, PG_POOL } from '../../shared/tokens.js';
import type { AuthContext } from '../identity/infrastructure/http/session.guard.js';
import { NotificationsService } from '../tasks/notifications.service.js';
import { MessagingService } from '../whatsapp/application/messaging.service.js';
import { nextAssignee } from './domain/round-robin.js';

/** Configuración por regla (validada al guardar; el resto del sistema confía en esta forma). */
export const RULE_CONFIGS = {
  new_lead: z.object({ taskDueMinutes: z.number().int().min(0).max(10_080).default(30), userIds: z.array(z.string()).max(50).optional(), lastAssignee: z.string().nullish() }),
  no_reply: z.object({ hours: z.number().min(0.25).max(168).default(2) }),
  stage_template: z.object({ stages: z.record(z.uuid(), z.uuid()).default({}) }),
  won_notify: z.object({}),
} as const;
export const ruleSchema = z.enum(['new_lead', 'no_reply', 'stage_template', 'won_notify']);
export const updateRuleSchema = z.object({ enabled: z.boolean(), config: z.record(z.string(), z.unknown()).default({}) }).strict();

const RULE_LABELS: Record<AutomationRule, string> = {
  new_lead: 'Lead nuevo: asignar por turnos y crear tarea',
  no_reply: 'Sin respuesta en X horas: avisar al responsable',
  stage_template: 'Cambio de etapa: enviar plantilla de WhatsApp',
  won_notify: 'Negocio ganado: avisar al equipo',
};

/**
 * E07-S01 — Cuatro reglas predefinidas activables, con log. Escuchan eventos de dominio:
 * no hay llamadas desde contactos o negocios hacia acá (el motor de E07-S02 reemplaza este módulo
 * sin tocar a los emisores).
 */
@Injectable()
export class AutomationService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PG_POOL) private readonly conn: { pool: pg.Pool },
    private readonly events: DomainEvents,
    private readonly notifications: NotificationsService,
    private readonly messaging: MessagingService,
  ) {}

  onModuleInit() {
    this.events.on('lead.created', (e) => this.onNewLead(e.tenantId, e.contactId, e.dealId, e.conversationId));
    this.events.on('deal.stage_changed', (e) => this.onStageChanged(e.tenantId, e.dealId, e.stageId));
    this.events.on('deal.won', (e) => this.onWon(e.tenantId, e.dealId));
  }

  async list(auth: AuthContext) {
    const rows = await withTenant(this.db, auth.tenantId, (tx) => tx.select().from(automationRules));
    return ruleSchema.options.map((rule) => {
      const row = rows.find((r) => r.rule === rule);
      return { rule, label: RULE_LABELS[rule], enabled: row?.enabled ?? false, config: RULE_CONFIGS[rule].parse(row?.config ?? {}) };
    });
  }

  async update(auth: AuthContext, rule: AutomationRule, input: z.infer<typeof updateRuleSchema>) {
    const parsed = RULE_CONFIGS[rule].safeParse(input.config);
    if (!parsed.success) throw badRequest('Configuración inválida para la regla');
    return withTenant(this.db, auth.tenantId, async (tx) => {
      const [row] = await tx.insert(automationRules).values({ tenantId: auth.tenantId, rule, enabled: input.enabled, config: parsed.data })
        .onConflictDoUpdate({ target: [automationRules.tenantId, automationRules.rule], set: { enabled: input.enabled, config: parsed.data } }).returning();
      return { rule, label: RULE_LABELS[rule], enabled: row!.enabled, config: row!.config };
    });
  }

  runs(auth: AuthContext) {
    return withTenant(this.db, auth.tenantId, (tx) => tx.select().from(automationRuns).orderBy(desc(automationRuns.createdAt), desc(automationRuns.id)).limit(100));
  }

  /** Lead nuevo → responsable por turnos (entre vendedores o los elegidos) + tarea de primera respuesta. */
  private async onNewLead(tenantId: string, contactId: string, dealId: string | null, conversationId: string | null) {
    await withTenant(this.db, tenantId, async (tx) => {
      const rule = await this.rule(tx, 'new_lead');
      if (!rule) return;
      const config = RULE_CONFIGS.new_lead.parse(rule.config);
      const { rows } = await tx.execute(sql`SELECT "userId" FROM member WHERE "organizationId" = ${tenantId} AND role = 'member' ORDER BY "userId"`);
      const sellers = (rows as { userId: string }[]).map((r) => r.userId);
      const candidates = config.userIds?.length ? sellers.filter((id) => config.userIds!.includes(id)) : sellers;
      const assignee = nextAssignee(candidates, config.lastAssignee ?? null);
      if (!assignee) return this.log(tx, tenantId, 'new_lead', contactId, 'skipped', 'No hay vendedores para asignar');

      const [contact] = await tx.update(contacts).set({ ownerId: assignee }).where(eq(contacts.id, contactId)).returning({ name: contacts.name });
      if (dealId) await tx.update(deals).set({ ownerId: assignee }).where(eq(deals.id, dealId));
      if (conversationId) await tx.update(conversations).set({ assignedTo: assignee }).where(eq(conversations.id, conversationId));
      await tx.insert(tasks).values({
        tenantId, title: `Responder a ${contact?.name ?? 'nuevo lead'}`, dealId, contactId, assigneeId: assignee,
        dueAt: new Date(Date.now() + config.taskDueMinutes * 60_000), remindBeforeMinutes: 0,
      });
      await tx.update(automationRules).set({ config: { ...config, lastAssignee: assignee } }).where(eq(automationRules.rule, 'new_lead'));
      await this.log(tx, tenantId, 'new_lead', contactId, 'ok', `Asignado a ${assignee}`);
    });
  }

  /** Cambio de etapa → plantilla configurada para esa etapa, a la conversación más reciente del contacto. */
  private async onStageChanged(tenantId: string, dealId: string, stageId: string) {
    const target = await withTenant(this.db, tenantId, async (tx) => {
      const rule = await this.rule(tx, 'stage_template');
      const templateId = rule ? RULE_CONFIGS.stage_template.parse(rule.config).stages[stageId] : undefined;
      if (!templateId) return null;
      const [deal] = await tx.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId));
      const [conversation] = deal?.contactId
        ? await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.contactId, deal.contactId)).orderBy(desc(conversations.lastMessageAt)).limit(1)
        : [];
      if (!conversation) {
        await this.log(tx, tenantId, 'stage_template', dealId, 'skipped', 'El contacto no tiene conversación de WhatsApp');
        return null;
      }
      return { templateId, conversationId: conversation.id };
    });
    if (!target) return;
    try {
      await this.messaging.sendTemplateAsSystem(tenantId, target.conversationId, target.templateId);
      await withTenant(this.db, tenantId, (tx) => this.log(tx, tenantId, 'stage_template', dealId, 'ok', 'Plantilla enviada'));
    } catch (error) {
      await withTenant(this.db, tenantId, (tx) => this.log(tx, tenantId, 'stage_template', dealId, 'error', (error as Error).message));
    }
  }

  /** Ganado → aviso a propietario, admins y responsable del negocio. */
  private async onWon(tenantId: string, dealId: string) {
    const created = await withTenant(this.db, tenantId, async (tx) => {
      if (!(await this.rule(tx, 'won_notify'))) return [];
      const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId));
      const { rows } = await tx.execute(sql`SELECT "userId" FROM member WHERE "organizationId" = ${tenantId} AND role IN ('owner', 'admin')`);
      const recipients = [...(rows as { userId: string }[]).map((r) => r.userId), ...(deal?.ownerId ? [deal.ownerId] : [])];
      const out = await this.notifications.create(tx, tenantId, recipients, {
        type: 'deal_won', title: `Negocio ganado: ${deal?.title ?? ''}`, body: `Valor: ${deal?.value ?? 0} ${deal?.currency ?? ''}`, link: `/deals?deal=${dealId}`,
      });
      await this.log(tx, tenantId, 'won_notify', dealId, 'ok', `${out.length} avisos`);
      return out;
    });
    await this.notifications.deliver(tenantId, created, true);
  }

  /**
   * "Sin respuesta en X horas" (barrido periódico): el cliente escribió y nadie del equipo
   * respondió después. Se avisa una vez por cada mensaje nuevo del cliente.
   */
  async sweepNoReply() {
    const { rows } = await this.conn.pool.query<{ tenant_id: string; config: Record<string, unknown> }>(`SELECT tenant_id, config FROM tenants_with_rule('no_reply')`);
    for (const { tenant_id: tenantId, config } of rows) {
      const { hours } = RULE_CONFIGS.no_reply.parse(config);
      const created = await withTenant(this.db, tenantId, async (tx) => {
        const pending = await tx.execute(sql`
          SELECT c.id, c.assigned_to, ct.owner_id, ct.name FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
          WHERE c.last_inbound_at < now() - make_interval(secs => ${hours * 3600})
            AND (c.no_reply_alerted_at IS NULL OR c.no_reply_alerted_at < c.last_inbound_at)
           AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.direction = 'out'
                            AND m.sent_by IS NOT NULL AND m.created_at > c.last_inbound_at)
           FOR UPDATE OF c SKIP LOCKED LIMIT 200`);
        const admins = (await tx.execute(sql`SELECT "userId" FROM member WHERE "organizationId" = ${tenantId} AND role IN ('owner', 'admin')`)).rows as { userId: string }[];
        const out = [];
        for (const row of pending.rows as { id: string; assigned_to: string | null; owner_id: string | null; name: string }[]) {
          await tx.update(conversations).set({ noReplyAlertedAt: new Date() }).where(eq(conversations.id, row.id));
          const recipient = row.assigned_to ?? row.owner_id;
          const recipients = recipient ? [recipient] : admins.map((r) => r.userId);
          out.push(...(await this.notifications.create(tx, tenantId, recipients, {
            type: 'no_reply', title: `${row.name} espera respuesta hace más de ${hours} h`, link: `/inbox?c=${row.id}`,
          })));
          await this.log(tx, tenantId, 'no_reply', row.id, 'ok', `Aviso a ${recipients.length} persona(s)`);
        }
        return out;
      });
      await this.notifications.deliver(tenantId, created, true);
    }
  }

  private async rule(tx: Transaction, rule: AutomationRule) {
    const [row] = await tx.select().from(automationRules).where(and(eq(automationRules.rule, rule), eq(automationRules.enabled, true)));
    return row ?? null;
  }

  private async log(tx: Transaction, tenantId: string, rule: AutomationRule, entityId: string, status: 'ok' | 'skipped' | 'error', detail: string) {
    await tx.insert(automationRuns).values({ tenantId, rule, entityId, status, detail });
  }
}
