import { ForbiddenException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gt, isNull, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Transaction } from '../../../shared/database/database.js';
import { contacts, conversations, messages, whatsappChannels, whatsappTemplates } from '../../../shared/database/schema.js';
import { withTenant } from '../../../shared/database/with-tenant.js';
import { AppError } from '../../../shared/http/app-error.js';
import { badRequest } from '../../../shared/http/errors.js';
import { can } from '../../identity/domain/permissions.js';
import type { JobQueue } from '../../../shared/queue/bull-queue.js';
import { RealtimeGateway } from '../../../shared/realtime/realtime.gateway.js';
import { DB, JOB_QUEUE, WHATSAPP_API } from '../../../shared/tokens.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { TenantContext } from '../../tenancy/application/tenant-context.js';
import { TenantSecrets } from '../../tenancy/infrastructure/tenant-secrets.js';
import { HUMAN_REPLY_PAUSE_HOURS, INDEFINITE_PAUSE } from '../../ai/domain/handoff.js';
import { classifyMetaError } from '../domain/meta-errors.js';
import { PhoneThrottle, ThrottledError } from '../domain/phone-throttle.js';
import { countVariables, renderTemplate, templateComponents } from '../domain/templates.js';
import { windowState } from '../domain/window.js';
import { MediaService, type StoredMedia } from './media.service.js';
import { MetaApiError, type OutboundPayload, type WhatsAppApi } from '../infrastructure/whatsapp-api.js';
import { tokenSecret } from './channels.service.js';

export const sendMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().trim().min(1).max(4096) }).strict(),
  z.object({
    type: z.enum(['image', 'video', 'audio', 'document']),
    link: z.url().refine((u) => u.startsWith('https://'), 'El archivo debe estar en una URL https'),
    caption: z.string().max(1024).optional(),
    filename: z.string().max(240).optional(),
  }).strict(),
  z.object({ type: z.literal('template'), templateId: z.uuid(), variables: z.array(z.string().trim().min(1).max(500)).max(20).default([]) }).strict(),
  // E04-S08 — Nota interna: queda en el hilo, nunca sale a Meta.
  z.object({ type: z.literal('note'), text: z.string().trim().min(1).max(4096) }).strict(),
]);

export const listConversationsSchema = z.object({
  filter: z.enum(['all', 'unread', 'mine', 'unassigned']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const assignSchema = z.object({ userId: z.string().max(64).nullable() }).strict();
export const aiPauseSchema = z.object({ paused: z.boolean() }).strict();

/** Job de la cola `outbound`: solo ids; el contenido se lee de la base al procesar. */
export interface SendJob {
  tenantId: string;
  messageId: string;
}
interface JobInfo {
  attemptsMade?: number;
  opts?: { attempts?: number };
}

/** E04-S03/S04 — Bandeja: conversaciones, mensajes y envío con ventana de 24 h. */
@Injectable()
export class MessagingService {
  constructor(
    private readonly tenant: TenantContext,
    private readonly secrets: TenantSecrets,
    private readonly realtime: RealtimeGateway,
    private readonly throttle: PhoneThrottle,
    private readonly media: MediaService,
    @Inject(DB) private readonly db: Database,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(WHATSAPP_API) private readonly api: WhatsAppApi,
  ) {}

  list(auth: AuthContext, { filter, limit }: z.infer<typeof listConversationsSchema>) {
    return this.tenant.run(auth, async (tx) => {
      const filters: Record<string, SQL | undefined> = {
        all: undefined,
        unread: gt(conversations.unreadCount, 0),
        mine: eq(conversations.assignedTo, auth.userId),
        unassigned: isNull(conversations.assignedTo),
      };
      const rows = await this.query(tx).where(and(await this.visible(tx, auth), filters[filter]))
        .orderBy(desc(conversations.lastMessageAt)).limit(limit);
      return rows.map(withWindow);
    });
  }

  /** E04-S07 — Contadores de la bandeja (respetan la visibilidad del vendedor). */
  counts(auth: AuthContext) {
    return this.tenant.run(auth, async (tx) => {
      const [row] = await tx
        .select({
          unread: sql<number>`count(*) FILTER (WHERE ${conversations.unreadCount} > 0)::int`,
          mine: sql<number>`count(*) FILTER (WHERE ${conversations.assignedTo} = ${auth.userId})::int`,
          unassigned: sql<number>`count(*) FILTER (WHERE ${conversations.assignedTo} IS NULL)::int`,
        })
        .from(conversations).innerJoin(contacts, eq(contacts.id, conversations.contactId))
        .where(await this.visible(tx, auth));
      return row!;
    });
  }

  /**
   * E04-S07 — Asignar/transferir. Propietario y admin: libre. Vendedor: tomar una sin asignar
   * (para sí) o transferir una que ya es suya.
   */
  assign(auth: AuthContext, id: string, { userId }: z.infer<typeof assignSchema>) {
    return this.tenant.run(auth, async (tx) => {
      const conversation = await this.findVisible(tx, auth, id);
      if (!can(auth.role, 'members:read')) {
        const takingFree = conversation.assignedTo === null && userId === auth.userId;
        const transferringOwn = conversation.assignedTo === auth.userId && userId !== null;
        if (!takingFree && !transferringOwn) throw new ForbiddenException('Solo puedes tomar conversaciones sin asignar o transferir las tuyas.');
      }
      if (userId) await this.tenant.assertMember(tx, auth, userId);
      await tx.update(conversations).set({ assignedTo: userId }).where(eq(conversations.id, id));
      this.realtime.publish(auth.tenantId, 'conversation.assigned', { conversationId: id, assignedTo: userId }, userId);
      return withWindow({ ...conversation, assignedTo: userId });
    });
  }

  get(auth: AuthContext, id: string) {
    return this.tenant.run(auth, async (tx) => withWindow(await this.findVisible(tx, auth, id)));
  }

  /** E05-S05 — Pausar (hasta reanudar) o reanudar la IA en una conversación. Cualquiera que la vea. */
  setAiPause(auth: AuthContext, id: string, { paused }: z.infer<typeof aiPauseSchema>) {
    return this.tenant.run(auth, async (tx) => {
      const conversation = await this.findVisible(tx, auth, id);
      const changes = paused ? { aiPausedUntil: INDEFINITE_PAUSE, aiPauseReason: 'manual' as const } : { aiPausedUntil: null, aiPauseReason: null };
      await tx.update(conversations).set(changes).where(eq(conversations.id, id));
      this.realtime.publish(auth.tenantId, 'conversation.updated', { conversationId: id }, null);
      return withWindow({ ...conversation, ...changes });
    });
  }

  listMessages(auth: AuthContext, id: string) {
    return this.tenant.run(auth, async (tx) => {
      await this.findVisible(tx, auth, id);
      const rows = await tx.select().from(messages).where(eq(messages.conversationId, id)).orderBy(desc(messages.createdAt), desc(messages.statusUpdatedAt), desc(messages.id)).limit(200);
      return rows.reverse().map(({ tenantId: _t, media, ...m }) => ({ ...m, media: this.media.present(media as StoredMedia | null) }));
    });
  }

  markRead(auth: AuthContext, id: string) {
    return this.tenant.run(auth, async (tx) => {
      await this.findVisible(tx, auth, id);
      await tx.update(conversations).set({ unreadCount: 0 }).where(eq(conversations.id, id));
    });
  }

  async send(auth: AuthContext, id: string, payload: z.infer<typeof sendMessageSchema>) {
    if (payload.type === 'note') {
      return this.tenant.run(auth, async (tx) => {
        await this.findVisible(tx, auth, id);
        const [note] = await tx.insert(messages).values({ tenantId: auth.tenantId, conversationId: id, direction: 'note', type: 'note', body: payload.text, status: 'internal', sentBy: auth.userId }).returning();
        this.realtime.publish(auth.tenantId, 'message.created', { conversationId: id, messageId: note!.id }, null);
        return { id: note!.id, status: note!.status };
      });
    }
    const message = await this.tenant.run(auth, async (tx) => {
      const conversation = await this.findVisible(tx, auth, id);
      if (conversation.channelStatus !== 'connected') {
        throw new AppError(HttpStatus.CONFLICT, 'CHANNEL_DISCONNECTED', 'El número de WhatsApp está desconectado: el propietario debe reconectarlo.');
      }
      if (payload.type !== 'template' && !windowState(conversation.lastInboundAt).open) {
        throw new AppError(HttpStatus.CONFLICT, 'WINDOW_CLOSED', 'Pasaron más de 24 horas desde el último mensaje del cliente: solo puedes enviar una plantilla aprobada.');
      }
      let body: string | null;
      let outbound: OutboundPayload | null = null;
      if (payload.type === 'template') {
        const [template] = await tx.select().from(whatsappTemplates).where(eq(whatsappTemplates.id, payload.templateId));
        if (!template || template.wabaId !== conversation.wabaId) throw badRequest('La plantilla no existe para este número');
        if (template.status !== 'APPROVED') throw new AppError(HttpStatus.CONFLICT, 'TEMPLATE_NOT_APPROVED', 'La plantilla todavía no está aprobada por Meta.');
        // E04-S09 — Quien pidió la baja no recibe plantillas (sí respuestas dentro de la ventana).
        if (conversation.contact.optOutAt) throw new AppError(HttpStatus.CONFLICT, 'CONTACT_OPTED_OUT', 'El contacto pidió no recibir más mensajes (BAJA).');
        const expected = countVariables(template.body);
        if (payload.variables.length !== expected) throw badRequest(`La plantilla necesita ${expected} variables`);
        body = renderTemplate(template.body, payload.variables);
        outbound = { type: 'template', name: template.name, language: template.language, components: templateComponents(payload.variables) };
      } else {
        body = payload.type === 'text' ? payload.text : (payload.caption ?? null);
        outbound = payload.type === 'text' ? null : payload;
      }
      const [row] = await tx.insert(messages).values({
        tenantId: auth.tenantId, conversationId: id, direction: 'out', type: payload.type, body, media: outbound, status: 'pending', sentBy: auth.userId,
      }).returning();
      // Respondió una persona: la próxima vez fuera de horario vuelve a contestar el mensaje automático (E04-S10)
      // y la IA se calla 24 h en esta conversación (E05-S05). Una pausa manual no se acorta.
      await tx.update(conversations).set({
        lastMessageAt: sql`now()`, autoReplyAt: null,
        aiPausedUntil: sql`CASE WHEN ${conversations.aiPauseReason} = 'manual' THEN ${conversations.aiPausedUntil} ELSE now() + make_interval(hours => ${HUMAN_REPLY_PAUSE_HOURS}) END`,
        aiPauseReason: sql`CASE WHEN ${conversations.aiPauseReason} = 'manual' THEN 'manual' ELSE 'human_reply' END`,
      }).where(eq(conversations.id, id));
      return row!;
    });
    await this.queue.enqueue('outbound', 'wa.send', { tenantId: auth.tenantId, messageId: message.id } satisfies SendJob, { jobId: message.id });
    return { id: message.id, status: message.status };
  }

  /**
   * Envío de plantilla por el SISTEMA (automatizaciones E07): sin sesión ni ventana, pero con las
   * mismas reglas de negocio (aprobada, del mismo número, contacto sin BAJA).
   */
  async sendTemplateAsSystem(tenantId: string, conversationId: string, templateId: string, variables: string[] = []) {
    const messageId = await withTenant(this.db, tenantId, async (tx) => {
      const [conversation] = await this.query(tx).where(eq(conversations.id, conversationId));
      if (!conversation || conversation.channelStatus !== 'connected') return null;
      const [template] = await tx.select().from(whatsappTemplates).where(eq(whatsappTemplates.id, templateId));
      if (!template || template.status !== 'APPROVED' || template.wabaId !== conversation.wabaId) throw new Error('Plantilla no aprobada para este número');
      if (conversation.contact.optOutAt) throw new Error('El contacto pidió la baja');
      if (variables.length !== countVariables(template.body)) throw new Error('Variables incompletas');
      const [row] = await tx.insert(messages).values({
        tenantId, conversationId, direction: 'out', type: 'template', body: renderTemplate(template.body, variables), status: 'pending',
        media: { type: 'template', name: template.name, language: template.language, components: templateComponents(variables) },
      }).returning({ id: messages.id });
      return row!.id;
    });
    if (messageId) await this.queue.enqueue('outbound', 'wa.send', { tenantId, messageId } satisfies SendJob, { jobId: messageId });
    return messageId;
  }

  /**
   * Worker de `wa.send`. Nunca mantiene una transacción abierta durante la llamada a Meta.
   * Reintentable (429, 5xx, ritmo) y quedan intentos → relanza para que BullMQ reintente con backoff.
   */
  async deliver({ tenantId, messageId }: SendJob, job: JobInfo = {}) {
    const isLastAttempt = !job.opts || (job.attemptsMade ?? 0) + 1 >= (job.opts.attempts ?? 1);
    const ctx = await withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .select({ message: messages, phone: contacts.phone, phoneNumberId: whatsappChannels.phoneNumberId, channelId: whatsappChannels.id, channelStatus: whatsappChannels.status })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .innerJoin(contacts, eq(contacts.id, conversations.contactId))
        .innerJoin(whatsappChannels, eq(whatsappChannels.id, conversations.channelId))
        .where(eq(messages.id, messageId));
      return row;
    });
    if (!ctx || ctx.message.status !== 'pending') return; // ya procesado: idempotente

    const fail = async (code: number, friendly: string) => {
      await this.update(tenantId, messageId, { status: 'failed', error: { code, message: friendly } }, ctx.message.conversationId);
    };
    if (ctx.channelStatus !== 'connected' || !ctx.phone) return fail(0, 'El número de WhatsApp está desconectado o el contacto no tiene teléfono.');

    try {
      await this.throttle.acquire(ctx.phoneNumberId);
    } catch (error) {
      if (error instanceof ThrottledError && !isLastAttempt) throw error;
      if (error instanceof ThrottledError) return fail(130429, 'No se pudo enviar por el límite de ritmo del número. Inténtalo de nuevo.');
      throw error;
    }

    const token = await this.secrets.get(tenantId, tokenSecret(ctx.phoneNumberId));
    if (!token) return fail(190, 'La conexión con WhatsApp no tiene credenciales: reconecta el número.');
    try {
      const payload: OutboundPayload = ctx.message.type === 'text' ? { type: 'text', text: ctx.message.body ?? '' } : (ctx.message.media as OutboundPayload);
      const { waMessageId } = await this.api.send(ctx.phoneNumberId, token, ctx.phone, payload);
      await this.update(tenantId, messageId, { status: 'sent', waMessageId }, ctx.message.conversationId);
    } catch (error) {
      if (!(error instanceof MetaApiError)) throw error;
      const classified = classifyMetaError(error.error, error.httpStatus);
      if (classified.disconnect) {
        await withTenant(this.db, tenantId, (tx) => tx.update(whatsappChannels).set({ status: 'disconnected', updatedAt: new Date() }).where(eq(whatsappChannels.id, ctx.channelId)));
      }
      if (classified.retryable && !isLastAttempt) throw error;
      await fail(classified.code, classified.retryable ? 'No se pudo enviar después de varios intentos. Inténtalo de nuevo.' : classified.friendly);
    }
  }

  private async update(tenantId: string, messageId: string, changes: Partial<typeof messages.$inferInsert>, conversationId: string) {
    await withTenant(this.db, tenantId, (tx) => tx.update(messages).set({ ...changes, statusUpdatedAt: new Date() }).where(eq(messages.id, messageId)));
    this.realtime.publish(tenantId, 'message.updated', { conversationId, messageId, status: changes.status }, null);
  }

  private visible(tx: Transaction, auth: AuthContext) {
    return visibleConversations(this.tenant, tx, auth);
  }

  private query(tx: Transaction) {
    return tx
      .select({
        id: conversations.id, status: conversations.status, unreadCount: conversations.unreadCount,
        lastMessageAt: conversations.lastMessageAt, lastInboundAt: conversations.lastInboundAt, assignedTo: conversations.assignedTo,
        aiPausedUntil: conversations.aiPausedUntil, aiPauseReason: conversations.aiPauseReason,
        // E05-S05 — Si el asistente está activo en la empresa (el vendedor no puede leer su configuración).
        aiAgentEnabled: sql<boolean>`coalesce((SELECT enabled FROM ai_agents), false)`,
        channelId: conversations.channelId, channelStatus: whatsappChannels.status, wabaId: whatsappChannels.wabaId,
        contact: { id: contacts.id, name: contacts.name, phone: contacts.phone, ownerId: contacts.ownerId, optOutAt: contacts.whatsappOptOutAt },
      })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .innerJoin(whatsappChannels, eq(whatsappChannels.id, conversations.channelId))
      .$dynamic();
  }

  private async findVisible(tx: Transaction, auth: AuthContext, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    const [row] = await this.query(tx).where(and(eq(conversations.id, id), await this.visible(tx, auth)));
    if (!row) throw new NotFoundException();
    return row;
  }
}

/**
 * Visibilidad en la bandeja: con "solo lo asignado", el vendedor ve las conversaciones de sus
 * contactos Y las que le asignaron (aunque el contacto sea de otro).
 */
async function visibleConversations(tenant: TenantContext, tx: Transaction, auth: AuthContext) {
  if ((await tenant.visibility(tx, auth)) !== 'assigned') return undefined;
  return or(eq(contacts.ownerId, auth.userId), eq(conversations.assignedTo, auth.userId));
}

function withWindow<T extends { lastInboundAt: Date | null }>(conversation: T) {
  return { ...conversation, window: windowState(conversation.lastInboundAt) };
}

