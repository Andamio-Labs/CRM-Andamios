import { Controller, Get, HttpStatus, Inject, Injectable, Module, UseGuards } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../shared/database/database.js';
import { withTenant } from '../../shared/database/with-tenant.js';
import { AppError } from '../../shared/http/app-error.js';
import { DB } from '../../shared/tokens.js';
import { IdentityModule } from '../identity/identity.module.js';
import { type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';
import { planLimits } from './domain/plans.js';

/** E10-S01 — Límites del plan y uso actual. Cada módulo pregunta antes de consumir. */
@Injectable()
export class PlanService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async status(tenantId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = (await tx.execute(sql`
        SELECT (SELECT plan FROM subscriptions) AS plan,
               (SELECT count(*)::int FROM member WHERE "organizationId" = ${tenantId}) AS users,
               (SELECT count(*)::int FROM whatsapp_channels WHERE status = 'connected') AS channels,
               coalesce((SELECT storage_bytes FROM tenant_usage), 0)::bigint AS storage`)).rows as [{ plan: string | null; users: number; channels: number; storage: string }];
      const plan = row.plan ?? 'trial';
      return { plan, limits: planLimits(plan), usage: { users: row.users, channels: row.channels, storageBytes: Number(row.storage) } };
    });
  }

  async assertCanAddChannel(tenantId: string) {
    const { limits, usage } = await this.status(tenantId);
    if (usage.channels >= limits.maxChannels) {
      throw new AppError(HttpStatus.CONFLICT, 'PLAN_CHANNEL_LIMIT_REACHED', `Tu plan permite ${limits.maxChannels} número(s) de WhatsApp. Mejora tu plan para conectar más.`);
    }
  }

  async assertStorage(tenantId: string, bytes: number) {
    const { limits, usage } = await this.status(tenantId);
    if (usage.storageBytes + bytes > limits.storageBytes) {
      throw new AppError(HttpStatus.CONFLICT, 'PLAN_STORAGE_LIMIT_REACHED', 'Se llenó el almacenamiento de tu plan. Mejora tu plan o libera espacio.');
    }
  }

  async addStorage(tx: Transaction, tenantId: string, bytes: number) {
    await tx.execute(sql`
      INSERT INTO tenant_usage (tenant_id, storage_bytes) VALUES (${tenantId}, ${bytes})
      ON CONFLICT (tenant_id) DO UPDATE SET storage_bytes = tenant_usage.storage_bytes + ${bytes}`);
  }
}

@Controller('v1/plan')
@UseGuards(SessionGuard, PermissionGuard)
class PlanController {
  constructor(private readonly plans: PlanService) {}

  @Get() @RequirePermission('settings:read')
  get(@CurrentAuth() auth: AuthContext) {
    return this.plans.status(auth.tenantId);
  }
}

@Module({ imports: [IdentityModule], controllers: [PlanController], providers: [PlanService], exports: [PlanService] })
export class BillingModule {}
