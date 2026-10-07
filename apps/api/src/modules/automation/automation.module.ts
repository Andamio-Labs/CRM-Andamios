import { Controller, Get, Inject, Module, type OnModuleInit, Param, Put, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import { ZodBody } from '../../shared/http/zod-validation.pipe.js';
import type { JobHandler, JobQueue } from '../../shared/queue/bull-queue.js';
import { JOB_HANDLERS } from '../../shared/queue/queue.module.js';
import { JOB_QUEUE } from '../../shared/tokens.js';
import { IdentityModule } from '../identity/identity.module.js';
import { type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { AutomationService, ruleSchema, updateRuleSchema } from './automation.service.js';

@Controller('v1/automation')
@UseGuards(SessionGuard, PermissionGuard)
class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get('rules') @RequirePermission('automation:manage')
  list(@CurrentAuth() auth: AuthContext) { return this.automation.list(auth); }

  @Put('rules/:rule') @RequirePermission('automation:manage')
  update(@CurrentAuth() auth: AuthContext, @Param('rule') rule: string, @ZodBody(updateRuleSchema) body: z.infer<typeof updateRuleSchema>) {
    return this.automation.update(auth, ruleSchema.parse(rule), body);
  }

  @Get('runs') @RequirePermission('automation:manage')
  runs(@CurrentAuth() auth: AuthContext) { return this.automation.runs(auth); }
}

/** E07-S01 — Reglas predefinidas. */
@Module({
  imports: [IdentityModule, TasksModule, WhatsAppModule],
  controllers: [AutomationController],
  providers: [AutomationService],
})
export class AutomationModule implements OnModuleInit {
  constructor(
    @Inject(JOB_HANDLERS) private readonly handlers: Record<string, JobHandler>,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly automation: AutomationService,
  ) {}

  async onModuleInit() {
    this.handlers['automation.no_reply'] = () => this.automation.sweepNoReply();
    await this.queue.schedule('automation.no_reply', 5 * 60_000);
  }
}
