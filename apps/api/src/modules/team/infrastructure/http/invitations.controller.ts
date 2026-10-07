import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ZodBody } from '../../../../shared/http/zod-validation.pipe.js';
import {
  type AuthContext,
  CurrentAuth,
  PermissionGuard,
  RequirePermission,
  SessionGuard,
  SessionResolver,
} from '../../../identity/infrastructure/http/session.guard.js';
import {
  type CreateInvitationInput,
  createInvitationSchema,
  InvitationsService,
} from '../../application/invitations.service.js';

/** E01-S03 — Gestión de invitaciones (equipo autenticado). */
@Controller('v1/invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly sessions: SessionResolver,
  ) {}

  @Post()
  @UseGuards(SessionGuard, PermissionGuard)
  @RequirePermission('members:invite')
  async create(@CurrentAuth() auth: AuthContext, @ZodBody(createInvitationSchema) body: CreateInvitationInput) {
    await this.invitations.create(auth, body);
    return { message: 'Invitación enviada.' };
  }

  @Get()
  @UseGuards(SessionGuard, PermissionGuard)
  @RequirePermission('members:read')
  list(@CurrentAuth() auth: AuthContext) {
    return this.invitations.listPending(auth.tenantId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard, PermissionGuard)
  @RequirePermission('members:invite')
  cancel(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.invitations.cancel(auth.tenantId, id);
  }

  /** Público: quien tiene el enlace ve a qué empresa lo invitan. */
  @Get(':id')
  describe(@Param('id') id: string) {
    return this.invitations.describe(id);
  }

  /** Público o con sesión: ver InvitationsService.accept. */
  @Post(':id/accept')
  async accept(@Param('id') id: string, @Req() req: Request, @Body() body: unknown) {
    const session = await this.sessions.resolve(req);
    await this.invitations.accept(id, session?.user ?? null, body, { ip: req.ip, userAgent: req.headers['user-agent'] });
    return { message: 'Te uniste al equipo.' };
  }
}
