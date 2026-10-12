import { Controller, Delete, Get, HttpCode, HttpStatus, Module, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import { ZodBody, ZodQuery } from '../../shared/http/zod-validation.pipe.js';
import { IdentityModule } from '../identity/identity.module.js';
import { type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { createMeetingSchema, listMeetingsSchema, MeetingsService, updateMeetingSchema } from './meetings.service.js';

@Controller('v1/meetings')
@UseGuards(SessionGuard, PermissionGuard)
class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Get() @RequirePermission('records:read')
  list(@CurrentAuth() auth: AuthContext, @ZodQuery(listMeetingsSchema) query: z.infer<typeof listMeetingsSchema>) { return this.meetingsService.list(auth, query); }

  @Get(':id') @RequirePermission('records:read')
  get(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.meetingsService.get(auth, id); }

  @Post() @RequirePermission('records:write')
  create(@CurrentAuth() auth: AuthContext, @ZodBody(createMeetingSchema) body: z.infer<typeof createMeetingSchema>) { return this.meetingsService.create(auth, body); }

  @Patch(':id') @RequirePermission('records:write')
  update(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(updateMeetingSchema) body: z.infer<typeof updateMeetingSchema>) { return this.meetingsService.update(auth, id, body); }

  @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('records:write')
  remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.meetingsService.remove(auth, id); }
}

/** E12-S03 — Reuniones. */
@Module({
  imports: [IdentityModule, TenancyModule, TasksModule],
  controllers: [MeetingsController],
  providers: [MeetingsService],
})
export class MeetingsModule {}
