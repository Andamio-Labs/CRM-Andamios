import { Controller, Delete, Get, HttpCode, HttpStatus, Module, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { AuditView } from '../../shared/http/audit.js';
import type { z } from 'zod';
import { ZodBody, ZodQuery } from '../../shared/http/zod-validation.pipe.js';
import { ContactsModule } from '../contacts/contacts.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { boardQuerySchema, closeDealSchema, createDealSchema, DealsService, listDealsSchema, moveDealSchema, updateDealSchema } from './application/deals.service.js';
import {
  createPipelineSchema, createReasonSchema, createStageSchema, PipelinesService, renamePipelineSchema,
  stageOrderSchema, updateReasonSchema, updateStageSchema,
} from './application/pipelines.service.js';

type Body<T extends z.ZodType> = z.infer<T>;

@Controller('v1')
@UseGuards(SessionGuard, PermissionGuard)
class PipelinesController {
  constructor(private readonly pipelines: PipelinesService, private readonly deals: DealsService) {}

  @Get('pipelines') @RequirePermission('records:read')
  list(@CurrentAuth() auth: AuthContext) { return this.pipelines.list(auth); }

  @Get('pipelines/:id/board') @RequirePermission('records:read')
  board(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodQuery(boardQuerySchema) query: z.infer<typeof boardQuerySchema>) { return this.deals.board(auth, id, query); }

  @Post('pipelines') @RequirePermission('pipelines:manage')
  create(@CurrentAuth() auth: AuthContext, @ZodBody(createPipelineSchema) body: Body<typeof createPipelineSchema>) { return this.pipelines.create(auth, body); }

  @Patch('pipelines/:id') @RequirePermission('pipelines:manage')
  rename(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(renamePipelineSchema) body: Body<typeof renamePipelineSchema>) { return this.pipelines.rename(auth, id, body); }

  @Delete('pipelines/:id') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('pipelines:manage')
  remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.pipelines.remove(auth, id); }

  @Post('pipelines/:id/stages') @RequirePermission('pipelines:manage')
  addStage(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(createStageSchema) body: Body<typeof createStageSchema>) { return this.pipelines.addStage(auth, id, body); }

  @Put('pipelines/:id/stage-order') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('pipelines:manage')
  reorder(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(stageOrderSchema) body: Body<typeof stageOrderSchema>) { return this.pipelines.reorderStages(auth, id, body); }

  @Patch('stages/:id') @RequirePermission('pipelines:manage')
  updateStage(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(updateStageSchema) body: Body<typeof updateStageSchema>) { return this.pipelines.updateStage(auth, id, body); }

  @Delete('stages/:id') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('pipelines:manage')
  removeStage(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.pipelines.removeStage(auth, id); }

  @Get('close-reasons') @RequirePermission('records:read')
  reasons(@CurrentAuth() auth: AuthContext) { return this.pipelines.listReasons(auth); }

  @Post('close-reasons') @RequirePermission('pipelines:manage')
  createReason(@CurrentAuth() auth: AuthContext, @ZodBody(createReasonSchema) body: Body<typeof createReasonSchema>) { return this.pipelines.createReason(auth, body); }

  @Patch('close-reasons/:id') @RequirePermission('pipelines:manage')
  updateReason(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(updateReasonSchema) body: Body<typeof updateReasonSchema>) { return this.pipelines.updateReason(auth, id, body); }
}

@Controller('v1/deals')
@UseGuards(SessionGuard, PermissionGuard)
class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get() @RequirePermission('records:read')
  list(@CurrentAuth() auth: AuthContext, @ZodQuery(listDealsSchema) query: z.infer<typeof listDealsSchema>) { return this.deals.list(auth, query); }

  @Post() @RequirePermission('records:write')
  create(@CurrentAuth() auth: AuthContext, @ZodBody(createDealSchema) body: Body<typeof createDealSchema>) { return this.deals.create(auth, body); }

  @Get(':id') @AuditView() @RequirePermission('records:read')
  get(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.deals.get(auth, id); }

  @Get(':id/events') @RequirePermission('records:read')
  events(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.deals.events(auth, id); }

  @Patch(':id') @RequirePermission('records:write')
  update(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(updateDealSchema) body: Body<typeof updateDealSchema>) { return this.deals.update(auth, id, body); }

  @Post(':id/move') @HttpCode(HttpStatus.OK) @RequirePermission('records:write')
  move(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(moveDealSchema) body: Body<typeof moveDealSchema>) { return this.deals.move(auth, id, body); }

  @Post(':id/close') @HttpCode(HttpStatus.OK) @RequirePermission('records:write')
  close(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(closeDealSchema) body: Body<typeof closeDealSchema>) { return this.deals.close(auth, id, body); }

  @Post(':id/reopen') @HttpCode(HttpStatus.OK) @RequirePermission('records:write')
  reopen(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.deals.reopen(auth, id); }

  @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('records:delete')
  remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.deals.remove(auth, id); }
}

/** E03 — Embudos de venta y negocios. */
@Module({
  imports: [IdentityModule, TenancyModule, ContactsModule],
  controllers: [PipelinesController, DealsController],
  providers: [PipelinesService, DealsService],
  exports: [PipelinesService],
})
export class PipelineModule {}
