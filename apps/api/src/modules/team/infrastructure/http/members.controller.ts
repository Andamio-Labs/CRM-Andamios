import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, UseGuards } from '@nestjs/common';
import { ZodBody } from '../../../../shared/http/zod-validation.pipe.js';
import {
  type AuthContext,
  CurrentAuth,
  PermissionGuard,
  RequirePermission,
  SessionGuard,
} from '../../../identity/infrastructure/http/session.guard.js';
import { type ChangeRoleInput, changeRoleSchema, MembersService } from '../../application/members.service.js';

@Controller('v1/members')
@UseGuards(SessionGuard, PermissionGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermission('members:read')
  list(@CurrentAuth() auth: AuthContext) {
    return this.members.list(auth.tenantId);
  }

  @Patch(':id')
  @RequirePermission('members:change-role')
  changeRole(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(changeRoleSchema) body: ChangeRoleInput) {
    return this.members.changeRole(auth, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('members:remove')
  remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.members.remove(auth, id);
  }
}
