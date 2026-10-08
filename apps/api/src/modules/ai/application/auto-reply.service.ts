import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type pg from 'pg';
import type { Env } from '../../../config/env.js';
import type { LlmMessage } from '../../../shared/ai/llm.js';
import type { Database, Transaction } from '../../../shared/database/database.js';
import {
  aiAgents, aiInteractions, aiUsageAlerts, contacts, conversations, deals, messages, tenantSettings, whatsappChannels,
} from '../../../shared/database/schema.js';
import { withTenant } from '../../../shared/database/with-tenant.js';
import type { JobQueue } from '../../../shared/queue/bull-queue.js';
import { RealtimeGateway } from '../../../shared/realtime/realtime.gateway.js';
import { DB, ENV, JOB_QUEUE, PG_POOL } from '../../../shared/tokens.js';
import { CustomFieldsService } from '../../contacts/application/custom-fields.service.js';
import { NotificationsService } from '../../tasks/notifications.service.js';
import { costMicros } from '../domain/cost.js';
import { agentOnDuty, INDEFINITE_PAUSE, isAiPaused, wantsHuman } from '../domain/handoff.js';
import { planCapture, qualificationTargets } from '../domain/qualification.js';
import { quotaState } from '../domain/quota.js';
import { AgentRuntime, handoffMessage, type TurnResult } from './agent-runtime.js';
import { AiUsageService } from './ai-usage.service.js';

/** Job de la cola `ai`: solo ids; todo se vuelve a leer al procesar. */
export interface AiReplyJob {
  tenantId: string;
  conversationId: string;
  messageId: string;
}

const HISTORY = 12;
type Notification = Awaited<ReturnType<NotificationsService['create']>>[number];

/**
 * E05-S03/S04/S05/S06/S08 — Respuesta automática a un mensaje de WhatsApp.
 * 1. Lee el contexto y decide si corresponde responder (activo, de turno, sin pausa, último mensaje).
 * 2. Cuota → palabra de escalamiento → turno del agente (sin transacción abierta durante el modelo).
 * 3. Guarda todo junto: respuesta, datos capturados, pausa, registro y avisos. Envía después del commit.
 */
@Injectable()
export class AutoReplyService {
  private readonly logger = new Logger('AiAutoReply');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PG_POOL) private readonly conn: { pool: pg.Pool },
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(ENV) private readonly env: Env,
    private readonly runtime: AgentRuntime,
    private readonly usage: AiUsageService,
    private readonly fields: CustomFieldsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async handle(job: AiReplyJob) {
    const ctx = await withTenant(this.db, job.tenantId, (tx) => this.context(tx, job));
    if (!ctx) return;
    const lang = ctx.agent.language;

    let turn: TurnResult | 'quota';
    if (ctx.quota.exhausted && ctx.agent.blockOnQuota) {
      turn = 'quota';
    } else if (wantsHuman(ctx.lastText, ctx.agent.handoffKeywords)) {
      turn = { ...emptyTurn(ctx.history), outcome: 'handoff', handoff: true, reply: handoffMessage(lang) };
    } else {
      turn = await this.runtime.respond({ tenantId: job.tenantId, companyName: ctx.companyName, agent: ctx.agent, history: ctx.history, capture: ctx.capture });
    }

    const effects = await withTenant(this.db, job.tenantId, (tx) => this.persist(tx, job, ctx, turn));
    if (effects.replyId) await this.queue.enqueue('outbound', 'wa.send', { tenantId: job.tenantId, messageId: effects.replyId }, { jobId: effects.replyId });
    if (effects.replyId) this.realtime.publish(job.tenantId, 'message.created', { conversationId: job.conversationId, messageId: effects.replyId }, ctx.ownerId);
    if (effects.paused) this.realtime.publish(job.tenantId, 'conversation.updated', { conversationId: job.conversationId }, null);
    if (effects.notifications.length) await this.notifications.deliver(job.tenantId, effects.notifications, true);
  }

  private async context(tx: Transaction, { tenantId, conversationId, messageId }: AiReplyJob) {
    const [agent] = await tx.select().from(aiAgents);
    if (!agent?.enabled || !this.runtime.configured) return null;
    const [conv] = await tx.select({
      pausedUntil: conversations.aiPausedUntil, assignedTo: conversations.assignedTo, channelStatus: whatsappChannels.status,
      contact: { id: contacts.id, name: contacts.name, phone: contacts.phone, email: contacts.email, customFields: contacts.customFields, ownerId: contacts.ownerId },
    }).from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .innerJoin(whatsappChannels, eq(whatsappChannels.id, conversations.channelId))
      .where(eq(conversations.id, conversationId));
    if (!conv || conv.channelStatus !== 'connected' || isAiPaused(conv.pausedUntil)) return null;

    if (!(await this.isCurrent(tx, conversationId, messageId, true))) return null;
    // Orden de LLEGADA (reloj de la base): la hora de Meta va en segundos y desordena el hilo frente a nuestras respuestas.
    const arrival = sql`CASE WHEN ${messages.direction} = 'in' THEN ${messages.statusUpdatedAt} ELSE ${messages.createdAt} END`;
    const recent = await tx.select().from(messages)
      .where(and(eq(messages.conversationId, conversationId), ne(messages.direction, 'note')))
      .orderBy(desc(arrival), desc(messages.createdAt), desc(messages.id)).limit(HISTORY);

    const [settings] = await tx.select().from(tenantSettings);
    if (!agentOnDuty(agent.schedule, settings!.businessHours, settings!.timezone, new Date())) return null;

    const history: LlmMessage[] = recent.reverse()
      .filter((m) => m.body && m.status !== 'failed')
      .map((m) => ({ role: m.direction === 'in' ? 'user' as const : 'assistant' as const, content: m.body! }));
    const lastText = trailing(history);
    const { rows } = await tx.execute<{ name: string }>(sql`SELECT name FROM organization WHERE id = ${tenantId}`);
    const [deal] = await tx.select({ id: deals.id, value: deals.value, description: deals.description, customFields: deals.customFields })
      .from(deals).where(and(eq(deals.contactId, conv.contact.id), eq(deals.status, 'open'))).orderBy(desc(deals.createdAt)).limit(1);
    const defs = { contact: await this.fields.definitions(tx, 'contact'), deal: await this.fields.definitions(tx, 'deal') };
    const capture = qualificationTargets(defs).filter((t) => agent.qualification.includes(t.target));

    return {
      agent, history, lastText, capture, defs, companyName: rows[0]?.name ?? '',
      contact: conv.contact, deal: deal ?? null, ownerId: conv.contact.ownerId, assignedTo: conv.assignedTo,
      quota: await this.usage.usage(tx),
    };
  }

  private async persist(tx: Transaction, job: AiReplyJob, ctx: NonNullable<Awaited<ReturnType<AutoReplyService['context']>>>, turn: TurnResult | 'quota') {
    const effects = { replyId: null as string | null, paused: false, notifications: [] as Notification[] };
    const base = { tenantId: job.tenantId, conversationId: job.conversationId, messageId: job.messageId, channel: 'whatsapp' as const };

    if (turn === 'quota') {
      await tx.insert(aiInteractions).values({ ...base, outcome: 'quota', prompt: { system: '', messages: [] }, error: 'Cuota mensual agotada' });
      effects.notifications.push(...(await this.quotaAlert(tx, job.tenantId, ctx.quota)));
      return effects;
    }

    // Una persona (o un mensaje nuevo del cliente) pudo llegar mientras el modelo pensaba: entonces no se envía nada.
    const stillOurs = await this.isCurrent(tx, job.conversationId, job.messageId, false);

    if (stillOurs && turn.reply) {
      const [row] = await tx.insert(messages).values({
        tenantId: job.tenantId, conversationId: job.conversationId, direction: 'out', type: 'text', body: turn.reply, status: 'pending', aiGenerated: true,
      }).returning({ id: messages.id });
      effects.replyId = row!.id;
      await tx.update(conversations).set({ lastMessageAt: sql`now()` }).where(eq(conversations.id, job.conversationId));
    }

    if (stillOurs && turn.handoff) {
      await tx.update(conversations)
        .set({ aiPausedUntil: INDEFINITE_PAUSE, aiPauseReason: turn.outcome === 'blocked' ? 'guardrail' : 'handoff' })
        .where(eq(conversations.id, job.conversationId));
      effects.paused = true;
      effects.notifications.push(...(await this.notifications.create(tx, job.tenantId, await this.handoffRecipients(job.tenantId, ctx), {
        type: 'ai_handoff',
        title: `${ctx.contact.name} necesita una persona`,
        body: turn.outcome === 'blocked'
          ? 'El asistente frenó una respuesta que no podía confirmar (precio o dato interno).'
          : turn.outcome === 'error' ? 'El asistente no pudo responder.' : 'El asistente pasó la conversación al equipo.',
        link: `/inbox?c=${job.conversationId}`,
      })));
    }

    const plan = planCapture(turn.fields, ctx.agent.qualification, { contact: ctx.contact, deal: ctx.deal }, ctx.defs);
    if (Object.keys(plan.contact).length) await tx.update(contacts).set({ ...plan.contact, updatedAt: new Date() }).where(eq(contacts.id, ctx.contact.id));
    if (ctx.deal && Object.keys(plan.deal).length) await tx.update(deals).set({ ...plan.deal, updatedAt: new Date() }).where(eq(deals.id, ctx.deal.id));

    const replied = turn.outcome === 'replied' && effects.replyId !== null;
    await tx.insert(aiInteractions).values({
      ...base, replyMessageId: effects.replyId, outcome: replied || turn.outcome !== 'replied' ? turn.outcome : 'error',
      model: turn.model, prompt: turn.prompt, response: turn.response, inputTokens: turn.inputTokens, outputTokens: turn.outputTokens,
      costMicros: costMicros(turn.inputTokens, turn.outputTokens, { inputPerMTok: this.env.LLM_PRICE_INPUT_PER_MTOK, outputPerMTok: this.env.LLM_PRICE_OUTPUT_PER_MTOK }),
      latencyMs: turn.latencyMs, violations: turn.violations, captured: plan.captured, sources: turn.sources,
      error: turn.error ?? (stillOurs ? null : 'Respondió una persona antes que el asistente'),
    });
    if (replied) effects.notifications.push(...(await this.quotaAlert(tx, job.tenantId, quotaState(ctx.quota.used + 1, ctx.quota.limit), ctx.quota.month)));
    return effects;
  }

  /**
   * ¿Este mensaje sigue siendo el turno a responder? No, si llegó otro del cliente (lo responde su propio
   * job) o si ya salió una respuesta. Nunca se mezclan relojes: los entrantes se comparan entre sí con la
   * hora de Meta (en segundos) y las respuestas contra el momento en que REGISTRAMOS el entrante
   * (`status_updated_at`, que en un entrante no cambia), ambos con el reloj de la base.
   */
  private async isCurrent(tx: Transaction, conversationId: string, messageId: string, requireText: boolean) {
    // Todo en SQL: traer las fechas a JS las trunca a milisegundos y el mensaje parecería más nuevo que sí mismo.
    const { rows } = await tx.execute<{ ok: boolean }>(sql`
      SELECT me.direction = 'in' AND (NOT ${requireText} OR me.type = 'text') AND NOT EXISTS (
        SELECT 1 FROM messages m
        WHERE m.conversation_id = ${conversationId} AND m.id <> me.id AND (
          -- Otro mensaje del cliente posterior (mismo segundo de Meta: desempata el orden de registro, luego el id).
          (m.direction = 'in' AND (m.created_at, m.status_updated_at, m.id) > (me.created_at, me.status_updated_at, me.id))
          -- Una respuesta (persona o IA) registrada después de que llegó este mensaje.
          OR (m.direction = 'out' AND m.created_at > me.status_updated_at)
        )
      ) AS ok
      FROM messages me WHERE me.id = ${messageId}`);
    return rows[0]?.ok === true;
  }

  /** E05-S06 — Un aviso por umbral (80 % y 100 %) y por mes, al propietario y los admins. */
  private async quotaAlert(tx: Transaction, tenantId: string, state: ReturnType<typeof quotaState>, month?: string) {
    if (!state.threshold) return [];
    const monthStart = month ?? (await this.usage.usage(tx)).month;
    const [inserted] = await tx.insert(aiUsageAlerts).values({ tenantId, month: monthStart, threshold: state.threshold }).onConflictDoNothing().returning();
    if (!inserted) return [];
    return this.notifications.create(tx, tenantId, await this.managers(tenantId), state.threshold === 100
      ? { type: 'ai_quota', title: 'El asistente llegó al 100 % de su cuota del mes', body: `Usó ${state.used} de ${state.limit} respuestas. Revisa tu plan o la opción de seguir respondiendo.`, link: '/settings?tab=ia' }
      : { type: 'ai_quota', title: 'El asistente va por el 80 % de su cuota del mes', body: `Usó ${state.used} de ${state.limit} respuestas.`, link: '/settings?tab=ia' });
  }

  /** Quien tiene la conversación asignada, si no el dueño del contacto; si no hay ninguno, propietario y admins. */
  private async handoffRecipients(tenantId: string, ctx: { assignedTo: string | null; ownerId: string | null }) {
    const direct = ctx.assignedTo ?? ctx.ownerId;
    return direct ? [direct] : this.managers(tenantId);
  }

  private async managers(tenantId: string) {
    const { rows } = await this.conn.pool.query<{ id: string }>(`SELECT "userId" AS id FROM member WHERE "organizationId" = $1 AND role IN ('owner', 'admin')`, [tenantId]);
    return rows.map((r) => r.id);
  }
}

function trailing(history: LlmMessage[]) {
  const out: string[] = [];
  for (let i = history.length - 1; i >= 0 && history[i]!.role === 'user'; i--) out.unshift(history[i]!.content);
  return out.join('\n');
}

function emptyTurn(history: LlmMessage[]): TurnResult {
  return {
    outcome: 'replied', reply: '', handoff: false, fields: {}, sources: [], violations: [], prompt: { system: '', messages: history },
    response: null, model: null, inputTokens: 0, outputTokens: 0, latencyMs: 0, error: null,
  };
}
