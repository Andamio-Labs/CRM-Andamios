import { Controller, Delete, Get, HttpCode, HttpStatus, Module, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import { NoAudit } from '../../shared/http/audit.js';
import { ZodBody, ZodQuery } from '../../shared/http/zod-validation.pipe.js';
import { ContactsModule } from '../contacts/contacts.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { AllowWhenReadOnly, type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { createRequestSchema, eraseSchema, listRequestsSchema, PrivacyService, resolveRequestSchema } from './application/privacy.service.js';
import { confirmDeletionSchema, TenantDeletionService } from './application/tenant-deletion.service.js';

/** Las solicitudes de titulares son obligación legal: se atienden aunque la cuenta esté en solo lectura. */
@Controller('v1/privacy/requests')
@UseGuards(SessionGuard, PermissionGuard)
class PrivacyRequestsController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get() @RequirePermission('privacy:manage')
  list(@CurrentAuth() auth: AuthContext, @ZodQuery(listRequestsSchema) query: z.infer<typeof listRequestsSchema>) { return this.privacy.listRequests(auth, query); }

  @Post() @AllowWhenReadOnly() @RequirePermission('privacy:manage')
  create(@CurrentAuth() auth: AuthContext, @ZodBody(createRequestSchema) body: z.infer<typeof createRequestSchema>) { return this.privacy.createRequest(auth, body); }

  @Post(':id/resolve') @HttpCode(HttpStatus.OK) @AllowWhenReadOnly() @RequirePermission('privacy:manage')
  resolve(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(resolveRequestSchema) body: z.infer<typeof resolveRequestSchema>) {
    return this.privacy.resolveRequest(auth, id, body);
  }
}

@Controller('v1/contacts')
@UseGuards(SessionGuard, PermissionGuard)
class PersonalDataController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get(':id/personal-data') @RequirePermission('privacy:manage')
  async export(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const data = await this.privacy.exportPersonalData(auth, id);
    res.setHeader('Content-Disposition', `attachment; filename="datos-personales-${id}.json"`);
    return data;
  }

  @Post(':id/erase') @HttpCode(HttpStatus.OK) @NoAudit() @AllowWhenReadOnly() @RequirePermission('privacy:manage')
  erase(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(eraseSchema) body: z.infer<typeof eraseSchema>) { return this.privacy.erase(auth, id, body); }
}

/** E13-S04 — Eliminar la empresa: solo el propietario, también en solo lectura. */
@Controller('v1/tenant')
@UseGuards(SessionGuard, PermissionGuard)
class TenantDeletionController {
  constructor(private readonly deletion: TenantDeletionService) {}

  @Post('deletion-request') @HttpCode(HttpStatus.ACCEPTED) @NoAudit() @AllowWhenReadOnly() @RequirePermission('tenant:delete')
  request(@CurrentAuth() auth: AuthContext) { return this.deletion.requestDeletion(auth); }

  @Delete() @HttpCode(HttpStatus.OK) @NoAudit() @AllowWhenReadOnly() @RequirePermission('tenant:delete')
  remove(@CurrentAuth() auth: AuthContext, @ZodBody(confirmDeletionSchema) body: z.infer<typeof confirmDeletionSchema>) { return this.deletion.deleteTenant(auth, body); }
}

/** E13-S03 derechos del titular, E13-S04 eliminación de la empresa. */
@Module({
  imports: [IdentityModule, TenancyModule, ContactsModule],
  controllers: [PrivacyRequestsController, PersonalDataController, TenantDeletionController],
  providers: [PrivacyService, TenantDeletionService],
})
export class PrivacyModule {}
