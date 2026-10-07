import { Controller, Delete, Get, HttpCode, HttpStatus, Inject, Module, type OnModuleInit, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import { ZodBody, ZodQuery } from '../../shared/http/zod-validation.pipe.js';
import type { JobHandler, JobQueue } from '../../shared/queue/bull-queue.js';
import { JOB_HANDLERS } from '../../shared/queue/queue.module.js';
import { JOB_QUEUE } from '../../shared/tokens.js';
import { IdentityModule } from '../identity/identity.module.js';
import { type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { NotificationsController, NotificationsService } from './notifications.service.js';
import { createTaskSchema, listTasksSchema, TasksService, updateTaskSchema } from './tasks.service.js';

@Controller('v1')
@UseGuards(SessionGuard, PermissionGuard)
class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get('tasks') @RequirePermission('records:read')
  list(@CurrentAuth() auth: AuthContext, @ZodQuery(listTasksSchema) query: z.infer<typeof listTasksSchema>) { return this.tasks.list(auth, query); }

  @Post('tasks') @RequirePermission('records:write')
  create(@CurrentAuth() auth: AuthContext, @ZodBody(createTaskSchema) body: z.infer<typeof createTaskSchema>) { return this.tasks.create(auth, body); }

  @Patch('tasks/:id') @RequirePermission('records:write')
  update(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(updateTaskSchema) body: z.infer<typeof updateTaskSchema>) { return this.tasks.update(auth, id, body); }

  @Delete('tasks/:id') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('records:write')
  remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.tasks.remove(auth, id); }

  @Get('dashboard') @RequirePermission('records:read')
  dashboard(@CurrentAuth() auth: AuthContext) { return this.tasks.dashboard(auth); }
}

/** E06 — Tareas, recordatorios y notificaciones. */
@Module({
  imports: [IdentityModule, TenancyModule],
  controllers: [TasksController, NotificationsController],
  providers: [TasksService, NotificationsService],
  exports: [TasksService, NotificationsService],
})
export class TasksModule implements OnModuleInit {
  constructor(
    @Inject(JOB_HANDLERS) private readonly handlers: Record<string, JobHandler>,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly tasks: TasksService,
  ) {}

  async onModuleInit() {
    this.handlers['tasks.reminders'] = () => this.tasks.sendDueReminders();
    await this.queue.schedule('tasks.reminders', 60_000);
  }
}
