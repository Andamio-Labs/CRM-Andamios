import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Module, type OnModuleInit, Param, Post, Put, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { z } from 'zod';
import type { Env } from '../../config/env.js';
import { NoAudit } from '../../shared/http/audit.js';
import { badRequest } from '../../shared/http/errors.js';
import { ZodBody, ZodQuery } from '../../shared/http/zod-validation.pipe.js';
import type { JobHandler, JobQueue } from '../../shared/queue/bull-queue.js';
import { JOB_HANDLERS } from '../../shared/queue/queue.module.js';
import { EMBEDDINGS_PROVIDER, ENV, JOB_QUEUE, LLM_PROVIDER, PAGE_FETCHER } from '../../shared/tokens.js';
import { ContactsModule } from '../contacts/contacts.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { AgentRuntime } from './application/agent-runtime.js';
import { AgentService, previewSchema, updateAgentSchema } from './application/agent.service.js';
import { AiLogsService, listInteractionsSchema } from './application/ai-logs.service.js';
import { AiUsageService } from './application/ai-usage.service.js';
import { type AiReplyJob, AutoReplyService } from './application/auto-reply.service.js';
import { type IndexJob, KnowledgeIndexer } from './application/knowledge-indexer.js';
import { KnowledgeRetriever } from './application/knowledge-retriever.js';
import { createSourceSchema, KnowledgeService, MAX_PDF_BYTES, pdfFieldsSchema, updateSourceSchema } from './application/knowledge.service.js';
import { fetchPublicPage } from './infrastructure/page-fetcher.js';
import { embeddingsFromEnv, llmFromEnv } from './infrastructure/providers.js';

@Controller('v1/ai')
@UseGuards(SessionGuard, PermissionGuard)
class AiController {
  constructor(
    private readonly agent: AgentService,
    private readonly usage: AiUsageService,
    private readonly logs: AiLogsService,
  ) {}

  @Get('agent') @RequirePermission('automation:manage')
  get(@CurrentAuth() auth: AuthContext) { return this.agent.get(auth); }

  @Put('agent') @RequirePermission('automation:manage')
  update(@CurrentAuth() auth: AuthContext, @ZodBody(updateAgentSchema) body: z.infer<typeof updateAgentSchema>) { return this.agent.update(auth, body); }

  @Post('agent/preview') @HttpCode(HttpStatus.OK) @NoAudit() @RequirePermission('automation:manage')
  preview(@CurrentAuth() auth: AuthContext, @ZodBody(previewSchema) body: z.infer<typeof previewSchema>) { return this.agent.preview(auth, body); }

  @Get('usage') @RequirePermission('automation:manage')
  getUsage(@CurrentAuth() auth: AuthContext) { return this.usage.get(auth); }

  @Get('interactions') @RequirePermission('ai:logs')
  interactions(@CurrentAuth() auth: AuthContext, @ZodQuery(listInteractionsSchema) query: z.infer<typeof listInteractionsSchema>) { return this.logs.list(auth, query); }

  @Get('interactions/:id') @RequirePermission('ai:logs')
  interaction(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.logs.get(auth, id); }
}

@Controller('v1/ai/knowledge')
@UseGuards(SessionGuard, PermissionGuard)
class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get() @RequirePermission('automation:manage')
  list(@CurrentAuth() auth: AuthContext) { return this.knowledge.list(auth); }

  @Get(':id') @RequirePermission('automation:manage')
  get(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.knowledge.get(auth, id); }

  @Post() @RequirePermission('automation:manage')
  create(@CurrentAuth() auth: AuthContext, @ZodBody(createSourceSchema) body: z.infer<typeof createSourceSchema>) { return this.knowledge.create(auth, body); }

  @Post('pdf') @RequirePermission('automation:manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PDF_BYTES, files: 1 } }))
  pdf(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @UploadedFile() file?: { originalname: string; buffer: Buffer }) {
    const fields = pdfFieldsSchema.safeParse(body);
    if (!fields.success) throw badRequest('Falta el título');
    return this.knowledge.createFromPdf(auth, fields.data, file);
  }

  @Post(':id/refresh') @HttpCode(HttpStatus.OK) @RequirePermission('automation:manage')
  refresh(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.knowledge.refresh(auth, id); }

  @Put(':id') @RequirePermission('automation:manage')
  update(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(updateSourceSchema) body: z.infer<typeof updateSourceSchema>) { return this.knowledge.update(auth, id, body); }

  @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('automation:manage')
  remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.knowledge.remove(auth, id); }
}

/** E05 — Agente de IA en WhatsApp. Proveedor por configuración: Groq o DeepSeek (LLM) y un modelo local (embeddings). */
@Module({
  imports: [IdentityModule, TenancyModule, ContactsModule, TasksModule],
  controllers: [AiController, KnowledgeController],
  providers: [
    AgentService, KnowledgeService, KnowledgeIndexer, KnowledgeRetriever, AgentRuntime, AutoReplyService, AiUsageService, AiLogsService,
    { provide: LLM_PROVIDER, inject: [ENV], useFactory: llmFromEnv },
    { provide: EMBEDDINGS_PROVIDER, inject: [ENV], useFactory: embeddingsFromEnv },
    { provide: PAGE_FETCHER, useValue: (url: string) => fetchPublicPage(url) },
  ],
  exports: [AgentRuntime],
})
export class AiModule implements OnModuleInit {
  constructor(
    @Inject(JOB_HANDLERS) private readonly handlers: Record<string, JobHandler>,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(ENV) private readonly env: Env,
    private readonly autoReply: AutoReplyService,
    private readonly indexer: KnowledgeIndexer,
  ) {}

  async onModuleInit() {
    this.handlers['ai.reply'] = (data: AiReplyJob) => this.autoReply.handle(data);
    this.handlers['ai.index'] = (data: IndexJob) => this.indexer.index(data);
    this.handlers['ai.index-sweep'] = () => this.indexer.sweep();
    if (this.env.EMBEDDINGS_API !== 'none') await this.queue.schedule('ai.index-sweep', 60 * 60_000);
  }
}
