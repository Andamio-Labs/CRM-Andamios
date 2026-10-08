import { Controller, Get, Headers, Inject, Module, type OnModuleInit, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import type { Env } from '../../config/env.js';
import { ZodQuery } from '../../shared/http/zod-validation.pipe.js';
import { sameSecret } from '../../shared/observability/metrics.js';
import type { JobHandler, JobQueue } from '../../shared/queue/bull-queue.js';
import { JOB_HANDLERS } from '../../shared/queue/queue.module.js';
import { ENV, JOB_QUEUE } from '../../shared/tokens.js';
import { IdentityModule } from '../identity/identity.module.js';
import { type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { rangeSchema, ReportsService } from './reports.service.js';

@Controller('v1/reports')
@UseGuards(SessionGuard, PermissionGuard)
class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('overview') @RequirePermission('records:read')
  overview(@CurrentAuth() auth: AuthContext, @ZodQuery(rangeSchema) range: z.infer<typeof rangeSchema>) { return this.reports.overview(auth, range); }

  @Get('performance') @RequirePermission('records:read')
  performance(@CurrentAuth() auth: AuthContext, @ZodQuery(rangeSchema) range: z.infer<typeof rangeSchema>) { return this.reports.performance(auth, range); }

  @Get('response-times') @RequirePermission('records:read')
  responseTimes(@CurrentAuth() auth: AuthContext, @ZodQuery(rangeSchema) range: z.infer<typeof rangeSchema>) { return this.reports.responseTimes(auth, range); }
}

/** E08-S04 — Uso interno de la plataforma (no de las empresas): exige METRICS_TOKEN siempre. */
@Controller('internal')
class InternalAnalyticsController {
  constructor(
    private readonly reports: ReportsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('activation-funnel')
  funnel(@Headers('authorization') authorization: string | undefined, @ZodQuery(rangeSchema) range: z.infer<typeof rangeSchema>) {
    if (!this.env.METRICS_TOKEN || !sameSecret(authorization ?? '', `Bearer ${this.env.METRICS_TOKEN}`)) throw new UnauthorizedException();
    return this.reports.activationFunnel(range);
  }
}

/** E08 — Analítica y reportes. */
@Module({
  imports: [IdentityModule, TenancyModule, TasksModule],
  controllers: [ReportsController, InternalAnalyticsController],
  providers: [ReportsService],
})
export class ReportsModule implements OnModuleInit {
  constructor(
    @Inject(JOB_HANDLERS) private readonly handlers: Record<string, JobHandler>,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly reports: ReportsService,
  ) {}

  async onModuleInit() {
    this.handlers['reports.sla'] = () => this.reports.alertSlaBreaches();
    await this.queue.schedule('reports.sla', 5 * 60_000);
  }
}
