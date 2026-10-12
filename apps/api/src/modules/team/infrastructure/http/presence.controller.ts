import { Controller, Get, Put, UseGuards } from '@nestjs/common';
import { NoAudit } from '../../../../shared/http/audit.js';
import { ZodBody } from '../../../../shared/http/zod-validation.pipe.js';
import {
  AllowWhenReadOnly,
  type AuthContext,
  CurrentAuth,
  PermissionGuard,
  RequirePermission,
  SessionGuard,
} from '../../../identity/infrastructure/http/session.guard.js';
import { PresenceService, type SetPresenceInput, setPresenceSchema } from '../../application/presence.service.js';

/** E01-S09 — Cada persona ve el estado del equipo y cambia el suyo. */
@Controller('v1/presence')
@UseGuards(SessionGuard, PermissionGuard)
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get()
  @RequirePermission('settings:read')
  list(@CurrentAuth() auth: AuthContext) {
    return this.presence.list(auth);
  }

  /** Cambiar el estado no modifica datos de la empresa: funciona en solo lectura y no se audita. */
  @Put()
  @AllowWhenReadOnly()
  @NoAudit()
  @RequirePermission('settings:read')
  set(@CurrentAuth() auth: AuthContext, @ZodBody(setPresenceSchema) body: SetPresenceInput) {
    return this.presence.set(auth, body);
  }
}
