import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../../shared/database/database.js';
import { quickReplies, whatsappChannels, whatsappTemplates } from '../../../shared/database/schema.js';
import { withTenant } from '../../../shared/database/with-tenant.js';
import { AppError } from '../../../shared/http/app-error.js';
import { badRequest, isUniqueViolation } from '../../../shared/http/errors.js';
import { DB, WHATSAPP_API } from '../../../shared/tokens.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { TenantContext } from '../../tenancy/application/tenant-context.js';
import { TenantSecrets } from '../../tenancy/infrastructure/tenant-secrets.js';
import { InvalidTemplateError, validateTemplate } from '../domain/templates.js';
import type { TemplateStatusUpdate } from '../domain/webhook-payload.js';
import { MetaApiError, type WhatsAppApi } from '../infrastructure/whatsapp-api.js';
import { tokenSecret } from './channels.service.js';

export const createTemplateSchema = z.object({
  channelId: z.uuid(),
  name: z.string(),
  language: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, 'Idioma inválido (p. ej. es_CO)'),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
  body: z.string(),
  examples: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
}).strict();

export const quickReplySchema = z.object({
  shortcut: z.string().regex(/^[a-z0-9_-]{1,30}$/, 'Atajo en minúsculas, sin espacios'),
  body: z.string().trim().min(1).max(4096),
}).strict();

const view = ({ tenantId: _t, createdBy: _c, ...t }: typeof whatsappTemplates.$inferSelect) => t;

/** E04-S05 — Plantillas: se validan aquí, se aprueban en Meta, el estado llega por webhook. */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly tenant: TenantContext,
    private readonly secrets: TenantSecrets,
    @Inject(WHATSAPP_API) private readonly api: WhatsAppApi,
    @Inject(DB) private readonly db: Database,
  ) {}

  list(auth: AuthContext) {
    return this.tenant.run(auth, async (tx) => (await tx.select().from(whatsappTemplates).orderBy(asc(whatsappTemplates.name))).map(view));
  }

  async create(auth: AuthContext, input: z.infer<typeof createTemplateSchema>) {
    try {
      validateTemplate(input);
    } catch (error) {
      if (error instanceof InvalidTemplateError) throw badRequest(error.message);
      throw error;
    }
    const [channel] = await this.tenant.run(auth, (tx) => tx.select().from(whatsappChannels).where(eq(whatsappChannels.id, input.channelId)));
    if (!channel) throw new NotFoundException('El número no existe');
    const token = await this.secrets.get(auth.tenantId, tokenSecret(channel.phoneNumberId));
    if (!token) throw new AppError(HttpStatus.CONFLICT, 'CHANNEL_NEEDS_RECONNECT', 'Reconecta el número para crear plantillas.');

    let meta: { id: string; status: string };
    try {
      meta = await this.api.createTemplate(channel.wabaId, token, input);
    } catch (error) {
      if (error instanceof MetaApiError) throw badRequest(`Meta rechazó la plantilla: ${error.error.message ?? 'sin detalle'}`);
      throw error;
    }
    try {
      return await this.tenant.run(auth, async (tx) => {
        const [row] = await tx.insert(whatsappTemplates).values({
          tenantId: auth.tenantId, wabaId: channel.wabaId, metaTemplateId: meta.id, name: input.name, language: input.language,
          category: input.category, body: input.body, examples: input.examples, createdBy: auth.userId,
          status: meta.status === 'APPROVED' ? 'APPROVED' : 'PENDING',
        }).returning();
        return view(row!);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError(HttpStatus.CONFLICT, 'TEMPLATE_EXISTS', 'Ya existe una plantilla con ese nombre e idioma.');
      throw error;
    }
  }

  /** Webhook: la WABA se enruta con la función acotada que salta RLS; el update corre con withTenant. */
  async applyStatusUpdate(update: TemplateStatusUpdate, tenantIds: string[]) {
    for (const tenantId of tenantIds) {
      await withTenant(this.db, tenantId, (tx) =>
        tx.update(whatsappTemplates)
          .set({ status: update.status, rejectionReason: update.reason, updatedAt: new Date() })
          .where(eq(whatsappTemplates.metaTemplateId, update.templateId)),
      );
    }
  }
}

/** E04-S08 — Respuestas rápidas del equipo (atajo "/"). Las variables se completan en la bandeja. */
@Injectable()
export class QuickRepliesService {
  constructor(private readonly tenant: TenantContext) {}

  list(auth: AuthContext) {
    return this.tenant.run(auth, (tx) =>
      tx.select({ id: quickReplies.id, shortcut: quickReplies.shortcut, body: quickReplies.body }).from(quickReplies).orderBy(asc(quickReplies.shortcut)),
    );
  }

  async create(auth: AuthContext, input: z.infer<typeof quickReplySchema>) {
    try {
      return await this.tenant.run(auth, async (tx) => (await tx.insert(quickReplies).values({ ...input, tenantId: auth.tenantId, createdBy: auth.userId }).returning())[0]!);
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError(HttpStatus.CONFLICT, 'QUICK_REPLY_EXISTS', `Ya existe el atajo /${input.shortcut}.`);
      throw error;
    }
  }

  remove(auth: AuthContext, id: string) {
    return this.tenant.run(auth, async (tx) => {
      if (!z.uuid().safeParse(id).success) throw new NotFoundException();
      const deleted = await tx.delete(quickReplies).where(eq(quickReplies.id, id)).returning({ id: quickReplies.id });
      if (!deleted.length) throw new NotFoundException();
    });
  }
}
