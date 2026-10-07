import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import type { Database, Transaction } from '../../../shared/database/database.js';
import { contacts, conversations, deals, messages, tenantSettings, waLinks } from '../../../shared/database/schema.js';
import { DomainEvents } from '../../../shared/events/domain-events.js';
import { extractRefCode } from '../../marketing/domain/wa-link.js';
import { withTenant } from '../../../shared/database/with-tenant.js';
import type { JobQueue } from '../../../shared/queue/bull-queue.js';
import { RealtimeGateway } from '../../../shared/realtime/realtime.gateway.js';
import { DB, JOB_QUEUE, PG_POOL } from '../../../shared/tokens.js';
import { createSystemDeal } from '../../pipeline/application/pipelines.service.js';
import { isWithinBusinessHours } from '../domain/business-hours.js';
import { consentKeyword } from '../domain/consent.js';
import { classifyMetaError } from '../domain/meta-errors.js';
import { canAdvanceStatus, type MessageStatus } from '../domain/message-status.js';
import { type InboundMessage, parseTemplateUpdates, parseWebhook, type WebhookBatch } from '../domain/webhook-payload.js';
import type { MediaJob } from './media.service.js';
import type { SendJob } from './messaging.service.js';
import { TemplatesService } from './templates.service.js';

const OPT_OUT_CONFIRMATION = 'Listo, no te enviaremos más mensajes promocionales. Si quieres volver a recibirlos, responde ALTA.';
const OPT_IN_CONFIRMATION = 'Listo, volverás a recibir nuestros mensajes. Para dejar de recibirlos responde BAJA.';

type Job = { queue: 'outbound' | 'webhooks'; name: string; data: SendJob | MediaJob; jobId: string };
type Event = { event: string; payload: object; ownerId: string | null };
type Lead = { contactId: string; dealId: string | null; conversationId: string };

/**
 * E04-S02 (+S06, S09, S10) — Procesa el webhook desde la cola. Enruta por phone_number_id con la
 * única función que salta RLS; todo lo demás corre aislado con withTenant(). Los trabajos derivados
 * (respuestas automáticas, descarga de multimedia) se encolan DESPUÉS del commit.
 */
@Injectable()
export class InboundService {
  private readonly logger = new Logger('WhatsAppInbound');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PG_POOL) private readonly conn: { pool: pg.Pool },
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly realtime: RealtimeGateway,
    private readonly templates: TemplatesService,
    private readonly domainEvents: DomainEvents,
  ) {}

  async process(payload: unknown) {
    for (const update of parseTemplateUpdates(payload)) {
      const { rows } = await this.conn.pool.query<{ tenant_id: string }>(`SELECT tenant_id FROM whatsapp_waba_route($1)`, [update.wabaId]);
      await this.templates.applyStatusUpdate(update, rows.map((r) => r.tenant_id));
    }
    for (const batch of parseWebhook(payload)) {
      const { rows } = await this.conn.pool.query<{ tenant_id: string; channel_id: string }>(
        `SELECT tenant_id, channel_id FROM whatsapp_channel_route($1)`,
        [batch.phoneNumberId],
      );
      if (!rows[0]) {
        this.logger.warn(`Webhook para un número no conectado (${batch.phoneNumberId}): ignorado`);
        continue;
      }
      await this.handleBatch(rows[0].tenant_id, rows[0].channel_id, batch);
    }
  }

  private async handleBatch(tenantId: string, channelId: string, batch: WebhookBatch) {
    const events: Event[] = [];
    const jobs: Job[] = [];
    const leads: Lead[] = [];

    await withTenant(this.db, tenantId, async (tx) => {
      const [settings] = await tx.select().from(tenantSettings);
      for (const msg of batch.messages) await this.handleMessage(tx, tenantId, channelId, batch.phoneNumberId, msg, settings!, events, jobs, leads);

      for (const update of batch.statuses) {
        const [current] = await tx.select().from(messages).where(eq(messages.waMessageId, update.waMessageId));
        if (!current || !canAdvanceStatus(current.status as MessageStatus, update.status)) continue;
        const error = update.error ? { code: update.error.code, message: classifyMetaError({ code: update.error.code }, 400).friendly } : null;
        await tx.update(messages).set({ status: update.status as MessageStatus, error, statusUpdatedAt: update.at }).where(eq(messages.id, current.id));
        events.push({ event: 'message.updated', payload: { conversationId: current.conversationId, messageId: current.id, status: update.status }, ownerId: null });
      }
    });

    for (const job of jobs) await this.queue.enqueue(job.queue, job.name, job.data, { jobId: job.jobId });
    for (const e of events) this.realtime.publish(tenantId, e.event, e.payload, e.ownerId);
    for (const lead of leads) await this.domainEvents.emit({ type: 'lead.created', tenantId, ...lead });
  }

  private async handleMessage(
    tx: Transaction, tenantId: string, channelId: string, phoneNumberId: string, msg: InboundMessage,
    settings: typeof tenantSettings.$inferSelect, events: Event[], jobs: Job[], leads: Lead[],
  ) {
    let [contact] = await tx.select().from(contacts).where(eq(contacts.phone, msg.from)).limit(1);
    const isNewLead = !contact;
    if (!contact) [contact] = await tx.insert(contacts).values({ tenantId, name: msg.profileName ?? msg.from, phone: msg.from, source: 'whatsapp' }).returning();

    // E09-S01 — El primer mensaje trae el código del enlace Click-to-WhatsApp: origen y campaña.
    const ref = msg.type === 'text' ? extractRefCode(msg.body) : null;
    if (ref && (isNewLead || !contact!.campaign)) {
      const [link] = await tx.select().from(waLinks).where(eq(waLinks.code, ref));
      if (link) {
        [contact] = await tx.update(contacts).set({ source: link.utmSource ?? 'click_to_whatsapp', campaign: link.utmCampaign }).where(eq(contacts.id, contact!.id)).returning();
      }
    }

    const [conversation] = await tx.insert(conversations)
      .values({ tenantId, channelId, contactId: contact!.id, lastMessageAt: msg.at })
      .onConflictDoUpdate({ target: [conversations.tenantId, conversations.channelId, conversations.contactId], set: { status: 'open' } })
      .returning();

    const media = msg.media ? { id: msg.media.id, mimeType: msg.media.mimeType, status: 'pending' as const } : null;
    const [inserted] = await tx.insert(messages)
      .values({ tenantId, conversationId: conversation!.id, direction: 'in', waMessageId: msg.waMessageId, type: msg.type, body: msg.body, media, status: 'received', createdAt: msg.at })
      .onConflictDoNothing({ target: messages.waMessageId })
      .returning({ id: messages.id });
    if (!inserted) return; // reintento de Meta: ya lo teníamos

    await tx.update(conversations).set({
      lastInboundAt: sql`greatest(coalesce(${conversations.lastInboundAt}, ${msg.at}), ${msg.at})`,
      lastMessageAt: sql`greatest(${conversations.lastMessageAt}, ${msg.at})`,
      unreadCount: sql`${conversations.unreadCount} + 1`,
    }).where(eq(conversations.id, conversation!.id));

    if (media) jobs.push({ queue: 'webhooks', name: 'wa.media', data: { tenantId, messageId: inserted.id, phoneNumberId, mediaId: media.id }, jobId: `media:${inserted.id}` });

    // E04-S09 — Consentimiento: escribir primero es consentimiento; BAJA/ALTA lo cambian.
    const keyword = msg.type === 'text' ? consentKeyword(msg.body) : null;
    if (keyword === 'opt_out') {
      await tx.update(contacts).set({ whatsappOptOutAt: new Date() }).where(eq(contacts.id, contact!.id));
      await this.reply(tx, tenantId, conversation!.id, OPT_OUT_CONFIRMATION, jobs);
    } else if (keyword === 'opt_in') {
      await tx.update(contacts).set({ whatsappOptOutAt: null, whatsappOptInAt: new Date(), whatsappOptInSource: 'palabra_alta' }).where(eq(contacts.id, contact!.id));
      await this.reply(tx, tenantId, conversation!.id, OPT_IN_CONFIRMATION, jobs);
    } else if (!contact!.whatsappOptInAt && !contact!.whatsappOptOutAt) {
      await tx.update(contacts).set({ whatsappOptInAt: msg.at, whatsappOptInSource: 'mensaje_entrante' }).where(eq(contacts.id, contact!.id));
    }

    // E04-S10 — Fuera de horario: una vez por conversación, hasta que responda una persona.
    const outOfHours = settings.outOfHoursEnabled && !isWithinBusinessHours(settings.businessHours, settings.timezone, msg.at);
    if (!keyword && outOfHours && !conversation!.autoReplyAt) {
      await tx.update(conversations).set({ autoReplyAt: new Date() }).where(eq(conversations.id, conversation!.id));
      await this.reply(tx, tenantId, conversation!.id, settings.outOfHoursMessage, jobs);
    }

    const [openDeal] = await tx.select({ id: deals.id }).from(deals).where(and(eq(deals.contactId, contact!.id), eq(deals.status, 'open'))).limit(1);
    let newDealId: string | null = null;
    if (!openDeal) {
      const deal = await createSystemDeal(tx, tenantId, { title: `${contact!.name} (WhatsApp)`, contactId: contact!.id, source: contact!.source ?? 'whatsapp' });
      if (deal) {
        newDealId = deal.id;
        events.push({ event: 'deal.created', payload: { dealId: deal.id, pipelineId: deal.pipelineId, stageId: deal.stageId, status: 'open' }, ownerId: null });
      }
    }
    if (isNewLead) leads.push({ contactId: contact!.id, dealId: newDealId, conversationId: conversation!.id });
    events.push({ event: 'message.created', payload: { conversationId: conversation!.id, messageId: inserted.id }, ownerId: contact!.ownerId });
  }

  /** Respuesta automática del sistema: va por la misma cola de envío que la de una persona. */
  private async reply(tx: Transaction, tenantId: string, conversationId: string, text: string, jobs: Job[]) {
    const [row] = await tx.insert(messages).values({ tenantId, conversationId, direction: 'out', type: 'text', body: text, status: 'pending' }).returning({ id: messages.id });
    jobs.push({ queue: 'outbound', name: 'wa.send', data: { tenantId, messageId: row!.id }, jobId: row!.id });
  }
}
