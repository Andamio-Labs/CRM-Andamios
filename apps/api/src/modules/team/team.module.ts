import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { LegalModule } from '../legal/legal.module.js';
import { InvitationsService } from './application/invitations.service.js';
import { MembersService } from './application/members.service.js';
import { InvitationsController } from './infrastructure/http/invitations.controller.js';
import { MembersController } from './infrastructure/http/members.controller.js';

/** Equipo: miembros, roles e invitaciones (E01-S03, E01-S04). */
@Module({
  imports: [IdentityModule, LegalModule],
  controllers: [MembersController, InvitationsController],
  providers: [MembersService, InvitationsService],
})
export class TeamModule {}
