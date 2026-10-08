import { Controller, Delete, Get, HttpCode, HttpStatus, Module, Param, Post, Put, UseGuards } from '@nestjs/common';
import { NoAudit } from '../../shared/http/audit.js';
import type { z } from 'zod';
import { NotConfiguredLlm } from '../../shared/ai/llm.js';
import { ZodBody } from '../../shared/http/zod-validation.pipe.js';
import { LLM_PROVIDER } from '../../shared/tokens.js';
import { IdentityModule } from '../identity/identity.module.js';
import { type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { AgentService, previewSchema, updateAgentSchema } from './application/agent.service.js';
import { createSourceSchema, KnowledgeService, updateSourceSchema } from './application/knowledge.service.js';

@Controller('v1/ai')
@UseGuards(SessionGuard, PermissionGuard)
class AiController {
  constructor(private readonly agent: AgentService) {}

  @Get('agent') @RequirePermission('automation:manage')
  get(@CurrentAuth() auth: AuthContext) { return this.agent.get(auth); }

  @Put('agent') @RequirePermission('automation:manage')
  update(@CurrentAuth() auth: AuthContext, @ZodBody(updateAgentSchema) body: z.infer<typeof updateAgentSchema>) { return this.agent.update(auth, body); }

  @Post('agent/preview') @HttpCode(HttpStatus.OK) @NoAudit() @RequirePermission('automation:manage')
  preview(@CurrentAuth() auth: AuthContext, @ZodBody(previewSchema) body: z.infer<typeof previewSchema>) { return this.agent.preview(auth, body); }
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

  @Put(':id') @RequirePermission('automation:manage')
  update(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(updateSourceSchema) body: z.infer<typeof updateSourceSchema>) { return this.knowledge.update(auth, id, body); }

  @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('automation:manage')
  remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.knowledge.remove(auth, id); }
}

/** E05 — Agente de IA. El proveedor real se conecta al final del MVP (decisión 2026-10-08). */
@Module({
  imports: [IdentityModule, TenancyModule],
  controllers: [AiController, KnowledgeController],
  providers: [AgentService, KnowledgeService, { provide: LLM_PROVIDER, useValue: new NotConfiguredLlm() }],
})
export class AiModule {}
