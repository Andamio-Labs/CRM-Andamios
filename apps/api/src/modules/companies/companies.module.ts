import { Controller, Delete, Get, HttpCode, HttpStatus, Module, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';
import { NoAudit } from '../../shared/http/audit.js';
import { ZodBody } from '../../shared/http/zod-validation.pipe.js';
import { IdentityModule } from '../identity/identity.module.js';
import { AllowWhenReadOnly, type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { CompaniesService, companyNameSchema, joinSchema } from './companies.service.js';

/** Mis empresas. Funciona aunque la empresa activa esté en solo lectura: crear otra o cambiarse no la modifica. */
@Controller('v1/my-companies')
@UseGuards(SessionGuard, PermissionGuard)
class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get() @RequirePermission('settings:read')
  list(@CurrentAuth() auth: AuthContext) { return this.companies.list(auth); }

  @Post() @AllowWhenReadOnly() @RequirePermission('settings:read')
  create(@CurrentAuth() auth: AuthContext, @ZodBody(companyNameSchema) body: z.infer<typeof companyNameSchema>, @Req() req: Request) {
    return this.companies.create(auth, body.name, req.headers);
  }

  @Patch('current') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('settings:update')
  rename(@CurrentAuth() auth: AuthContext, @ZodBody(companyNameSchema) body: z.infer<typeof companyNameSchema>) { return this.companies.rename(auth, body.name); }

  @Post('join') @AllowWhenReadOnly() @RequirePermission('settings:read')
  join(@CurrentAuth() auth: AuthContext, @ZodBody(joinSchema) body: z.infer<typeof joinSchema>) { return this.companies.join(auth, body.code); }

  @Get('requests') @RequirePermission('settings:read')
  myRequests(@CurrentAuth() auth: AuthContext) { return this.companies.myRequests(auth); }

  @Delete('requests/:id') @HttpCode(HttpStatus.NO_CONTENT) @AllowWhenReadOnly() @RequirePermission('settings:read')
  cancel(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.companies.cancelMyRequest(auth, id); }

  @Post(':id/activate') @HttpCode(HttpStatus.NO_CONTENT) @AllowWhenReadOnly() @NoAudit() @RequirePermission('settings:read')
  activate(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Req() req: Request) { return this.companies.activate(auth, id, req.headers); }
}

/** Solicitudes para unirse a la empresa activa: las revisa quien puede invitar. */
@Controller('v1/join-requests')
@UseGuards(SessionGuard, PermissionGuard)
class JoinRequestsController {
  constructor(private readonly companies: CompaniesService) {}

  @Get() @RequirePermission('members:invite')
  pending(@CurrentAuth() auth: AuthContext) { return this.companies.pending(auth); }

  @Post(':id/approve') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('members:invite')
  approve(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.companies.approve(auth, id); }

  @Post(':id/reject') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('members:invite')
  reject(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.companies.reject(auth, id); }
}

/** E01-S10 — Multiempresa. */
@Module({
  imports: [IdentityModule, TasksModule],
  controllers: [CompaniesController, JoinRequestsController],
  providers: [CompaniesService],
})
export class CompaniesModule {}
