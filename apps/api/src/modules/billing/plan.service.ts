import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Injectable, Module, type OnModuleInit, Post, Put, UseGuards } from '@nestjs/common';
import { NoAudit } from '../../shared/http/audit.js';
import type { z } from 'zod';
import type { Env } from '../../config/env.js';
import { ZodBody } from '../../shared/http/zod-validation.pipe.js';
import type { JobHandler, JobQueue } from '../../shared/queue/bull-queue.js';
import { JOB_HANDLERS } from '../../shared/queue/queue.module.js';
import { sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../shared/database/database.js';
import { withTenant } from '../../shared/database/with-tenant.js';
import { AppError } from '../../shared/http/app-error.js';
import { DB, ENV, JOB_QUEUE, WOMPI_API } from '../../shared/tokens.js';
import { IdentityModule } from '../identity/identity.module.js';
import { AllowWhenReadOnly, type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { BillingService, paymentMethodSchema, subscribeSchema } from './application/billing.service.js';
import { planLimits } from './domain/plans.js';
import { HttpWompiApi, LocalWompiApi } from './infrastructure/wompi-api.js';

/** E10-S01 — Límites del plan y uso actual. Cada módulo pregunta antes de consumir. */
@Injectable()
export class PlanService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async status(tenantId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = (await tx.execute(sql`
        SELECT (SELECT plan FROM subscriptions) AS plan,
               account_status(${tenantId}) AS status,
               (SELECT trial_ends_at FROM subscriptions) AS trial_ends_at,
               (SELECT count(*)::int FROM member WHERE "organizationId" = ${tenantId}) AS users,
               (SELECT count(*)::int FROM whatsapp_channels WHERE status = 'connected') AS channels,
               coalesce((SELECT storage_bytes FROM tenant_usage), 0)::bigint AS storage`)).rows as [{ plan: string | null; status: string | null; trial_ends_at: Date | null; users: number; channels: number; storage: string }];
      const plan = row.plan ?? 'trial';
      return { plan, status: row.status ?? 'trialing', trialEndsAt: row.trial_ends_at, limits: planLimits(plan), usage: { users: row.users, channels: row.channels, storageBytes: Number(row.storage) } };
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

/** E10-S03 — Estado de cuenta, tarjeta y suscripción (solo el propietario). */
@Controller('v1/billing')
@UseGuards(SessionGuard, PermissionGuard)
class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get() @RequirePermission('billing:manage')
  account(@CurrentAuth() auth: AuthContext) { return this.billing.account(auth); }

  @Get('checkout') @RequirePermission('billing:manage')
  checkout() { return this.billing.checkout(); }

  @Put('payment-method') @AllowWhenReadOnly() @NoAudit() @RequirePermission('billing:manage')
  paymentMethod(@CurrentAuth() auth: AuthContext, @ZodBody(paymentMethodSchema) body: z.infer<typeof paymentMethodSchema>) { return this.billing.setPaymentMethod(auth, body); }

  @Post('subscribe') @HttpCode(HttpStatus.ACCEPTED) @AllowWhenReadOnly() @RequirePermission('billing:manage')
  subscribe(@CurrentAuth() auth: AuthContext, @ZodBody(subscribeSchema) body: z.infer<typeof subscribeSchema>) { return this.billing.subscribe(auth, body); }
}

/** Eventos de Wompi: sin sesión; la autenticidad la da el checksum. */
@Controller('webhooks/wompi')
class WompiWebhookController {
  constructor(private readonly billing: BillingService) {}

  @Post() @HttpCode(HttpStatus.OK)
  async receive(@Body() body: unknown) {
    await this.billing.handleEvent(body);
    return { received: true };
  }
}

@Module({
  imports: [IdentityModule, TasksModule],
  controllers: [PlanController, BillingController, WompiWebhookController],
  providers: [
    PlanService, BillingService,
    {
      provide: WOMPI_API,
      inject: [ENV],
      useFactory: (env: Env) => env.WOMPI_API === 'local'
        ? new LocalWompiApi()
        : new HttpWompiApi({ baseUrl: env.WOMPI_URL, publicKey: env.WOMPI_PUBLIC_KEY, privateKey: env.WOMPI_PRIVATE_KEY }),
    },
  ],
  exports: [PlanService],
})
export class BillingModule implements OnModuleInit {
  constructor(
    @Inject(JOB_HANDLERS) private readonly handlers: Record<string, JobHandler>,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly billing: BillingService,
  ) {}

  async onModuleInit() {
    this.handlers['billing.renewals'] = () => this.billing.chargeDueSubscriptions();
    this.handlers['billing.trials'] = () => this.billing.expireTrials();
    await this.queue.schedule('billing.renewals', 60 * 60_000);
    await this.queue.schedule('billing.trials', 60 * 60_000);
  }
}
