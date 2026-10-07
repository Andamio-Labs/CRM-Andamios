import { Controller, Get, Inject, NotFoundException, Patch, UseGuards } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../../shared/database/database.js';
import { tenantSettings } from '../../shared/database/schema.js';
import { withTenant } from '../../shared/database/with-tenant.js';
import { ZodBody } from '../../shared/http/zod-validation.pipe.js';
import { RealtimeGateway } from '../../shared/realtime/realtime.gateway.js';
import { DB } from '../../shared/tokens.js';
import {
  type AuthContext,
  CurrentAuth,
  PermissionGuard,
  RequirePermission,
  SessionGuard,
} from '../identity/infrastructure/http/session.guard.js';
import { type UpdateTenantSettings, updateTenantSettingsSchema } from './domain/tenant-settings.js';

/** E01-S06 — Configuración de empresa. Permisos según docs/permissions.md. */
@Controller('v1/tenant/settings')
@UseGuards(SessionGuard, PermissionGuard)
export class TenantSettingsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Get()
  @RequirePermission('settings:read')
  async get(@CurrentAuth() auth: AuthContext) {
    return this.findOrFail(auth.tenantId);
  }

  @Patch()
  @RequirePermission('settings:update')
  async update(@CurrentAuth() auth: AuthContext, @ZodBody(updateTenantSettingsSchema) changes: UpdateTenantSettings) {
    await withTenant(this.db, auth.tenantId, (tx) =>
      tx.update(tenantSettings).set({ ...changes, updatedAt: sql`now()` }).where(eq(tenantSettings.tenantId, auth.tenantId)),
    );
    if (changes.sellersSeeOnlyAssigned !== undefined) this.realtime.disconnectSellers(auth.tenantId); // auditoría #2
    return this.findOrFail(auth.tenantId);
  }

  private async findOrFail(tenantId: string) {
    const [row] = await withTenant(this.db, tenantId, (tx) => tx.select().from(tenantSettings));
    if (!row) throw new NotFoundException();
    const { tenantId: _, ...settings } = row;
    return settings;
  }
}
