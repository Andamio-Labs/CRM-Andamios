import { Controller, Delete, Get, HttpCode, HttpStatus, Module, Param, Post, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import { NoAudit } from '../../shared/http/audit.js';
import { ZodBody, ZodQuery } from '../../shared/http/zod-validation.pipe.js';
import { IdentityModule } from '../identity/identity.module.js';
import { AllowWhenReadOnly, type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { ChatService, createChatSchema, listMessagesSchema, postMessageSchema } from './chat.service.js';

@Controller('v1/team-chats')
@UseGuards(SessionGuard, PermissionGuard)
class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get() @RequirePermission('records:read')
  list(@CurrentAuth() auth: AuthContext) { return this.chat.list(auth); }

  @Post() @RequirePermission('records:write')
  create(@CurrentAuth() auth: AuthContext, @ZodBody(createChatSchema) body: z.infer<typeof createChatSchema>) { return this.chat.create(auth, body); }

  @Get(':id/messages') @RequirePermission('records:read')
  messages(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodQuery(listMessagesSchema) query: z.infer<typeof listMessagesSchema>) { return this.chat.messages(auth, id, query); }

  /** Sin auditoría automática: copiaría el contenido de las conversaciones del equipo al registro. */
  @Post(':id/messages') @NoAudit() @RequirePermission('records:write')
  post(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(postMessageSchema) body: z.infer<typeof postMessageSchema>) { return this.chat.post(auth, id, body); }

  @Delete(':id/messages/:messageId') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('records:write')
  remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Param('messageId') messageId: string) { return this.chat.remove(auth, id, messageId); }

  @Post(':id/read') @HttpCode(HttpStatus.NO_CONTENT) @AllowWhenReadOnly() @NoAudit() @RequirePermission('records:read')
  read(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.chat.read(auth, id); }
}

/** E12-S03 — Chat interno del equipo. */
@Module({
  imports: [IdentityModule, TenancyModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
