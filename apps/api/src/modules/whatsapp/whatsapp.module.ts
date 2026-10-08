import { AuditView } from '../../shared/http/audit.js';
import {
  Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, Inject, Module, Param, Patch, Post, Query, type RawBodyRequest,
  Req, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Env } from '../../config/env.js';
import { ZodBody, ZodQuery } from '../../shared/http/zod-validation.pipe.js';
import type { JobHandler, JobQueue } from '../../shared/queue/bull-queue.js';
import { JOB_HANDLERS } from '../../shared/queue/queue.module.js';
import { ATTEMPT_STORE, ENV, JOB_QUEUE, WHATSAPP_API } from '../../shared/tokens.js';
import type { AttemptStore } from '../identity/domain/login-throttle.js';
import { IdentityModule } from '../identity/identity.module.js';
import { type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';
import { BillingModule } from '../billing/plan.service.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { ChannelsService, connectSchema } from './application/channels.service.js';
import { InboundService } from './application/inbound.service.js';
import { MediaController, type MediaJob, MediaService } from './application/media.service.js';
import { assignSchema, listConversationsSchema, MessagingService, type SendJob, sendMessageSchema } from './application/messaging.service.js';
import { createTemplateSchema, QuickRepliesService, quickReplySchema, TemplatesService } from './application/templates.service.js';
import { PhoneThrottle } from './domain/phone-throttle.js';
import { verifyMetaSignature } from './domain/webhook-signature.js';
import { GraphWhatsAppApi, LocalWhatsAppApi } from './infrastructure/whatsapp-api.js';

/**
 * E04-S02 — Webhook público de Meta. Sin sesión ni Origin: lo autentica la firma HMAC.
 * Responde rápido y encola: el procesamiento pesado va por la cola `webhooks`.
 */
@Controller('webhooks/whatsapp')
class WhatsAppWebhookController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  @Get()
  verify(@Query() query: Record<string, string>) {
    if (query['hub.mode'] !== 'subscribe' || query['hub.verify_token'] !== this.env.META_VERIFY_TOKEN) throw new ForbiddenException();
    return query['hub.challenge'];
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() req: RawBodyRequest<Request>) {
    if (!req.rawBody || !verifyMetaSignature(req.rawBody, req.headers['x-hub-signature-256'] as string | undefined, this.env.META_APP_SECRET)) {
      throw new UnauthorizedException('Firma inválida');
    }
    const jobId = createHash('sha256').update(req.rawBody).digest('hex');
    await this.queue.enqueue('webhooks', 'wa.inbound', req.body, { jobId });
    return { received: true };
  }
}

@Controller('v1')
@UseGuards(SessionGuard, PermissionGuard)
class WhatsAppController {
  constructor(
    private readonly channels: ChannelsService,
    private readonly messaging: MessagingService,
    private readonly templatesService: TemplatesService,
    private readonly quickRepliesService: QuickRepliesService,
  ) {}

  @Get('whatsapp/channels') @RequirePermission('records:read')
  listChannels(@CurrentAuth() auth: AuthContext) { return this.channels.list(auth); }

  @Post('whatsapp/channels') @RequirePermission('channels:manage')
  connect(@CurrentAuth() auth: AuthContext, @ZodBody(connectSchema) body: z.infer<typeof connectSchema>) { return this.channels.connect(auth, body); }

  @Post('whatsapp/channels/:id/refresh') @HttpCode(HttpStatus.OK) @RequirePermission('channels:manage')
  refresh(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.channels.refresh(auth, id); }

  @Delete('whatsapp/channels/:id') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('channels:manage')
  disconnect(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.channels.disconnect(auth, id); }

  @Get('conversations') @RequirePermission('records:read')
  conversations(@CurrentAuth() auth: AuthContext, @ZodQuery(listConversationsSchema) query: z.infer<typeof listConversationsSchema>) { return this.messaging.list(auth, query); }

  @Get('conversations/counts') @RequirePermission('records:read')
  counts(@CurrentAuth() auth: AuthContext) { return this.messaging.counts(auth); }

  @Patch('conversations/:id/assignment') @RequirePermission('records:write')
  assign(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(assignSchema) body: z.infer<typeof assignSchema>) { return this.messaging.assign(auth, id, body); }

  @Get('whatsapp/templates') @RequirePermission('records:read')
  templates(@CurrentAuth() auth: AuthContext) { return this.templatesService.list(auth); }

  @Post('whatsapp/templates') @RequirePermission('templates:manage')
  createTemplate(@CurrentAuth() auth: AuthContext, @ZodBody(createTemplateSchema) body: z.infer<typeof createTemplateSchema>) { return this.templatesService.create(auth, body); }

  @Get('quick-replies') @RequirePermission('records:read')
  quickReplies(@CurrentAuth() auth: AuthContext) { return this.quickRepliesService.list(auth); }

  @Post('quick-replies') @RequirePermission('templates:manage')
  createQuickReply(@CurrentAuth() auth: AuthContext, @ZodBody(quickReplySchema) body: z.infer<typeof quickReplySchema>) { return this.quickRepliesService.create(auth, body); }

  @Delete('quick-replies/:id') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('templates:manage')
  removeQuickReply(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.quickRepliesService.remove(auth, id); }

  @Get('conversations/:id') @RequirePermission('records:read')
  conversation(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.messaging.get(auth, id); }

  @Get('conversations/:id/messages') @AuditView() @RequirePermission('records:read')
  messages(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.messaging.listMessages(auth, id); }

  @Post('conversations/:id/read') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('records:read')
  read(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.messaging.markRead(auth, id); }

  @Post('conversations/:id/messages') @HttpCode(HttpStatus.ACCEPTED) @RequirePermission('records:write')
  send(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(sendMessageSchema) body: z.infer<typeof sendMessageSchema>) {
    return this.messaging.send(auth, id, body);
  }
}

/** E04 — Bandeja WhatsApp. Registra sus handlers de cola al iniciar. */
@Module({
  imports: [IdentityModule, TenancyModule, BillingModule],
  exports: [MessagingService],
  controllers: [WhatsAppWebhookController, WhatsAppController, MediaController],
  providers: [
    ChannelsService, InboundService, MessagingService, TemplatesService, QuickRepliesService, MediaService,
    {
      provide: WHATSAPP_API,
      inject: [ENV],
      useFactory: (env: Env) => env.WHATSAPP_API === 'local'
        ? new LocalWhatsAppApi()
        : new GraphWhatsAppApi({ baseUrl: env.META_GRAPH_URL, version: env.META_GRAPH_VERSION, appId: env.META_APP_ID, appSecret: env.META_APP_SECRET }),
    },
    { provide: PhoneThrottle, inject: [ATTEMPT_STORE, ENV], useFactory: (store: AttemptStore, env: Env) => new PhoneThrottle(store, env.WA_SEND_PER_SECOND) },
  ],
})
export class WhatsAppModule {
  constructor(
    @Inject(JOB_HANDLERS) handlers: Record<string, JobHandler>,
    inbound: InboundService,
    messaging: MessagingService,
    media: MediaService,
  ) {
    handlers['wa.inbound'] = (payload) => inbound.process(payload);
    handlers['wa.send'] = (data: SendJob, job) => messaging.deliver(data, job);
    handlers['wa.media'] = (data: MediaJob) => media.fetch(data);
  }
}
