import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { LegalModule } from '../legal/legal.module.js';
import { InvitationsService } from './application/invitations.service.js';
import { MembersService } from './application/members.service.js';
import { PresenceService } from './application/presence.service.js';
import { InvitationsController } from './infrastructure/http/invitations.controller.js';
import { MembersController } from './infrastructure/http/members.controller.js';
import { PresenceController } from './infrastructure/http/presence.controller.js';

/** Equipo: miembros, roles, invitaciones y estado de cada persona (E01-S03, E01-S04, E01-S09). */
@Module({
  imports: [IdentityModule, LegalModule],
  controllers: [MembersController, InvitationsController, PresenceController],
  providers: [MembersService, InvitationsService, PresenceService],
  exports: [PresenceService],
})
export class TeamModule {}
