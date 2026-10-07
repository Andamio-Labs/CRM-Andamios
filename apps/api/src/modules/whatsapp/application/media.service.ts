import { ForbiddenException, Get, Inject, Injectable, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { Controller } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Response } from 'express';
import type { Database } from '../../../shared/database/database.js';
import { messages } from '../../../shared/database/schema.js';
import { withTenant } from '../../../shared/database/with-tenant.js';
import { RealtimeGateway } from '../../../shared/realtime/realtime.gateway.js';
import type { ObjectStorage } from '../../../shared/storage/object-storage.js';
import { DB, STORAGE, WHATSAPP_API } from '../../../shared/tokens.js';
import { PlanService } from '../../billing/plan.service.js';
import { TenantSecrets } from '../../tenancy/infrastructure/tenant-secrets.js';
import { mediaPolicy } from '../domain/media-policy.js';
import type { WhatsAppApi } from '../infrastructure/whatsapp-api.js';
import { tokenSecret } from './channels.service.js';

export interface MediaJob {
  tenantId: string;
  messageId: string;
  phoneNumberId: string;
  mediaId: string;
}

export interface StoredMedia {
  id?: string;
  mimeType: string | null;
  status: 'pending' | 'ready' | 'too_large' | 'failed';
  key?: string;
  size?: number;
}

/**
 * E04-S06 — Descarga la multimedia de Meta (sus URLs vencen en minutos) y la guarda en nuestro
 * almacenamiento. Se lee siempre con URL firmada de corta duración.
 */
@Injectable()
export class MediaService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    @Inject(WHATSAPP_API) private readonly api: WhatsAppApi,
    private readonly secrets: TenantSecrets,
    private readonly realtime: RealtimeGateway,
    private readonly plans: PlanService,
  ) {}

  async fetch({ tenantId, messageId, phoneNumberId, mediaId }: MediaJob) {
    const token = await this.secrets.get(tenantId, tokenSecret(phoneNumberId));
    if (!token) return this.mark(tenantId, messageId, { mimeType: null, status: 'failed' });

    const info = await this.api.getMedia(mediaId, token);
    const policy = mediaPolicy(info.mimeType);
    if (info.fileSize > policy.maxBytes) return this.mark(tenantId, messageId, { mimeType: info.mimeType, status: 'too_large', size: info.fileSize });

    try {
      await this.plans.assertStorage(tenantId, info.fileSize);
    } catch {
      return this.mark(tenantId, messageId, { mimeType: info.mimeType, status: 'failed', size: info.fileSize }); // E10-S01: almacenamiento lleno
    }
    const body = await this.api.downloadMedia(info.url, token, policy.maxBytes);
    const key = `t/${tenantId}/m/${messageId}`;
    await this.storage.put(key, body, info.mimeType);
    await withTenant(this.db, tenantId, (tx) => this.plans.addStorage(tx, tenantId, body.length));
    await this.mark(tenantId, messageId, { mimeType: info.mimeType, status: 'ready', key, size: body.length });
  }

  /** Para la API: nunca exponemos la clave interna ni el id de Meta, solo una URL firmada. */
  present(media: StoredMedia | null) {
    if (!media) return null;
    const { key, id: _metaId, ...rest } = media;
    return media.status === 'ready' && key ? { ...rest, url: this.storage.signedUrl(key) } : rest;
  }

  private async mark(tenantId: string, messageId: string, media: StoredMedia) {
    const [row] = await withTenant(this.db, tenantId, (tx) =>
      tx.update(messages).set({ media }).where(eq(messages.id, messageId)).returning({ conversationId: messages.conversationId }),
    );
    if (row) this.realtime.publish(tenantId, 'message.updated', { conversationId: row.conversationId, messageId }, null);
  }
}

/** GET /api/media/<clave>?expires=&signature= — sirve archivos con URL firmada (sin sesión). */
@Controller('media')
export class MediaController {
  constructor(@Inject(STORAGE) private readonly storage: ObjectStorage) {}

  @Get('*key')
  async serve(@Param('key') key: string | string[], @Query('expires') expires: string, @Query('signature') signature: string, @Res() res: Response) {
    const path = Array.isArray(key) ? key.join('/') : key;
    if (!this.storage.verify(path, Number(expires), signature ?? '')) throw new ForbiddenException('Enlace inválido o vencido');
    const file = await this.storage.get(path);
    if (!file) throw new NotFoundException();
    const { inline } = mediaPolicy(file.contentType);
    res.set({
      // sandbox: aunque alguien logre servir HTML, no ejecuta scripts ni comparte origen con la app.
      'Content-Security-Policy': "sandbox; default-src 'none'; media-src 'self'; img-src 'self'",
      'Content-Type': inline ? file.contentType : 'application/octet-stream',
      'Content-Disposition': inline ? 'inline' : 'attachment',
      'Cache-Control': 'private, max-age=300',
    });
    res.send(file.body);
  }
}
