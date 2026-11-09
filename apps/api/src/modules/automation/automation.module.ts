import { Controller, Delete, Get, HttpCode, HttpStatus, Inject, Module, type OnModuleInit, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import { ZodBody, ZodQuery } from '../../shared/http/zod-validation.pipe.js';
import type { JobHandler, JobQueue } from '../../shared/queue/bull-queue.js';
import { JOB_HANDLERS } from '../../shared/queue/queue.module.js';
import { JOB_QUEUE } from '../../shared/tokens.js';
import { IdentityModule } from '../identity/identity.module.js';
import { type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { TeamModule } from '../team/team.module.js';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { AutomationService, ruleSchema, updateRuleSchema } from './automation.service.js';
import { createRobotSchema, listRobotsSchema, RobotsService, updateRobotSchema } from './robots.service.js';

@Controller('v1/automation')
@UseGuards(SessionGuard, PermissionGuard)
class AutomationController {
  constructor(private readonly automation: AutomationService, private readonly robots: RobotsService) {}

  @Get('rules') @RequirePermission('automation:manage')
  list(@CurrentAuth() auth: AuthContext) { return this.automation.list(auth); }

  @Put('rules/:rule') @RequirePermission('automation:manage')
  update(@CurrentAuth() auth: AuthContext, @Param('rule') rule: string, @ZodBody(updateRuleSchema) body: z.infer<typeof updateRuleSchema>) {
    return this.automation.update(auth, ruleSchema.parse(rule), body);
  }

  @Get('runs') @RequirePermission('automation:manage')
  runs(@CurrentAuth() auth: AuthContext) { return this.automation.runs(auth); }

  // E07-S04 — Robots por etapa.
  @Get('robots') @RequirePermission('automation:manage')
  listRobots(@CurrentAuth() auth: AuthContext, @ZodQuery(listRobotsSchema) query: z.infer<typeof listRobotsSchema>) { return this.robots.list(auth, query.pipelineId); }

  @Get('robots/runs') @RequirePermission('automation:manage')
  robotRuns(@CurrentAuth() auth: AuthContext) { return this.robots.runs(auth); }

  @Post('robots') @RequirePermission('automation:manage')
  createRobot(@CurrentAuth() auth: AuthContext, @ZodBody(createRobotSchema) body: z.infer<typeof createRobotSchema>) { return this.robots.create(auth, body); }

  @Patch('robots/:id') @RequirePermission('automation:manage')
  updateRobot(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(updateRobotSchema) body: z.infer<typeof updateRobotSchema>) { return this.robots.update(auth, id, body); }

  @Delete('robots/:id') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('automation:manage')
  removeRobot(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.robots.remove(auth, id); }
}

/** E07-S01 — Reglas predefinidas. E07-S04 — Robots por etapa. */
@Module({
  imports: [IdentityModule, TasksModule, TeamModule, WhatsAppModule],
  controllers: [AutomationController],
  providers: [AutomationService, RobotsService],
})
export class AutomationModule implements OnModuleInit {
  constructor(
    @Inject(JOB_HANDLERS) private readonly handlers: Record<string, JobHandler>,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly automation: AutomationService,
    private readonly robots: RobotsService,
  ) {}

  async onModuleInit() {
    this.handlers['automation.no_reply'] = () => this.automation.sweepNoReply();
    await this.queue.schedule('automation.no_reply', 5 * 60_000);
    this.handlers['automation.robots'] = () => this.robots.sweep();
    await this.queue.schedule('automation.robots', 5 * 60_000);
  }
}
