import { BadRequestException, ForbiddenException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import type { Env } from '../../../config/env.js';
import type { Database } from '../../../shared/database/database.js';
import { subscriptions } from '../../../shared/database/schema.js';
import { withTenant } from '../../../shared/database/with-tenant.js';
import { AppError } from '../../../shared/http/app-error.js';
import type { Mailer } from '../../../shared/mail/mailer.js';
import { AUTH, DB, ENV, MAILER, PG_POOL } from '../../../shared/tokens.js';
import { planLimits } from '../../billing/domain/plans.js';
import { can } from '../../identity/domain/permissions.js';
import { PASSWORD_MIN_LENGTH, type Auth } from '../../identity/infrastructure/auth.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { type AcceptanceContext, LegalService } from '../../legal/legal.module.js';
import { invitationEmail } from './invitation-email.js';

export const INVITATION_TTL_DAYS = 7;

export const createInvitationSchema = z
  .object({ email: z.email().trim().toLowerCase(), role: z.enum(['admin', 'member']) })
  .strict();
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

const newAccountSchema = z.object({
  name: z.string().trim().min(2).max(120),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(128),
  acceptLegal: z.literal(true),
});

interface InvitationRow {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  role: 'admin' | 'member';
  status: 'pending' | 'accepted' | 'canceled' | 'rejected';
  expiresAt: Date;
}

type SessionUser = { id: string; email: string };

/**
 * E01-S03 — Invitaciones. El id de la invitación ES el secreto del enlace:
 * 32 caracteres aleatorios (192 bits), imposible de adivinar.
 */
@Injectable()
export class InvitationsService {
  constructor(
    @Inject(PG_POOL) private readonly conn: { pool: pg.Pool },
    @Inject(DB) private readonly db: Database,
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
    private readonly legal: LegalService,
  ) {}

  async create(inviter: AuthContext, input: CreateInvitationInput): Promise<{ id: string }> {
    if (input.role === 'admin' && !can(inviter.role, 'members:invite-admin')) {
      throw new ForbiddenException('Solo el propietario puede invitar administradores.');
    }
    const maxUsers = await this.maxUsers(inviter.tenantId);
    const id = randomBytes(24).toString('base64url');
    const client = await this.conn.pool.connect();
    try {
      await client.query('BEGIN');
      // Serializa las invitaciones del tenant: dos invitaciones simultáneas no pueden pasarse del cupo.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`seats:${inviter.tenantId}`]);

      const { rows: [existing] } = await client.query<{ member: boolean; invited: boolean }>(
        `SELECT
           EXISTS (SELECT 1 FROM member m JOIN "user" u ON u.id = m."userId"
                   WHERE m."organizationId" = $1 AND u.email = $2) AS member,
           EXISTS (SELECT 1 FROM invitation WHERE "organizationId" = $1 AND email = $2
                   AND status = 'pending' AND "expiresAt" > now()) AS invited`,
        [inviter.tenantId, input.email],
      );
      if (existing!.member) throw new AppError(HttpStatus.CONFLICT, 'ALREADY_MEMBER', 'Esa persona ya es parte del equipo.');
      if (existing!.invited) throw new AppError(HttpStatus.CONFLICT, 'ALREADY_INVITED', 'Ya hay una invitación pendiente para ese correo.');

      const { rows: [seats] } = await client.query<{ used: number }>(
        `SELECT (SELECT count(*) FROM member WHERE "organizationId" = $1)
              + (SELECT count(*) FROM invitation WHERE "organizationId" = $1
                 AND status = 'pending' AND "expiresAt" > now()) AS used`,
        [inviter.tenantId],
      );
      if (Number(seats!.used) >= maxUsers) {
        throw new AppError(
          HttpStatus.CONFLICT,
          'PLAN_USER_LIMIT_REACHED',
          `Tu plan permite ${maxUsers} usuarios (incluye invitaciones pendientes). Mejora tu plan para sumar más.`,
        );
      }

      await client.query(
        `INSERT INTO invitation (id, "organizationId", email, role, status, "expiresAt", "createdAt", "inviterId")
         VALUES ($1, $2, $3, $4, 'pending', now() + make_interval(days => $5), now(), $6)`,
        [id, inviter.tenantId, input.email, input.role, INVITATION_TTL_DAYS, inviter.userId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const { rows: [names] } = await this.conn.pool.query<{ organization: string; inviter: string }>(
      `SELECT o.name AS organization, u.name AS inviter FROM organization o, "user" u WHERE o.id = $1 AND u.id = $2`,
      [inviter.tenantId, inviter.userId],
    );
    await this.mailer.send(
      invitationEmail({
        to: input.email,
        organization: names!.organization,
        inviter: names!.inviter,
        role: input.role,
        url: `${this.env.APP_URL}/invitations/${id}`,
        days: INVITATION_TTL_DAYS,
      }),
    );
    return { id };
  }

  async listPending(tenantId: string) {
    const { rows } = await this.conn.pool.query(
      `SELECT id, email, role, "expiresAt", "createdAt" FROM invitation
       WHERE "organizationId" = $1 AND status = 'pending' AND "expiresAt" > now() ORDER BY "createdAt" DESC`,
      [tenantId],
    );
    return rows;
  }

  async cancel(tenantId: string, id: string): Promise<void> {
    const { rowCount } = await this.conn.pool.query(
      `UPDATE invitation SET status = 'canceled' WHERE id = $1 AND "organizationId" = $2 AND status = 'pending'`,
      [id, tenantId],
    );
    if (!rowCount) throw new NotFoundException();
  }

  /** Vista pública para la pantalla de aceptación (quien tiene el enlace tiene el secreto). */
  async describe(id: string) {
    const invitation = await this.find(id);
    const { rowCount } = await this.conn.pool.query(`SELECT 1 FROM "user" WHERE email = $1`, [invitation.email]);
    return {
      organizationName: invitation.organizationName,
      email: invitation.email,
      role: invitation.role,
      status: this.isUsable(invitation) ? 'pending' : invitation.status === 'pending' ? 'expired' : invitation.status,
      accountExists: Boolean(rowCount),
    };
  }

  /**
   * Con sesión: la cuenta logueada debe ser la del correo invitado.
   * Sin sesión: crea la cuenta (el enlace prueba que el correo es suyo → queda verificado).
   */
  async accept(id: string, sessionUser: SessionUser | null, body: unknown, context: AcceptanceContext): Promise<void> {
    const invitation = await this.find(id);
    this.assertUsable(invitation);

    let userId: string;
    let createdUserId: string | null = null;
    if (sessionUser) {
      if (sessionUser.email.toLowerCase() !== invitation.email) {
        throw new ForbiddenException('Esta invitación es para otro correo.');
      }
      userId = sessionUser.id;
    } else {
      const { rowCount } = await this.conn.pool.query(`SELECT 1 FROM "user" WHERE email = $1`, [invitation.email]);
      if (rowCount) {
        throw new AppError(HttpStatus.CONFLICT, 'LOGIN_REQUIRED', 'Ya tienes una cuenta: inicia sesión para aceptar.');
      }
      const parsed = newAccountSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Datos inválidos' });
      userId = createdUserId = await this.createVerifiedUser(invitation.email, parsed.data);
      await this.legal.recordAcceptance(userId, context);
    }

    const client = await this.conn.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [locked] } = await client.query<InvitationRow>(
        `SELECT id, status, "expiresAt" FROM invitation WHERE id = $1 FOR UPDATE`,
        [id],
      );
      this.assertUsable({ ...invitation, ...locked! });
      await client.query(
        `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
         SELECT $1, $2, $3, $4, now()
         WHERE NOT EXISTS (SELECT 1 FROM member WHERE "organizationId" = $2 AND "userId" = $3)`,
        [randomBytes(16).toString('hex'), invitation.organizationId, userId, invitation.role],
      );
      await client.query(`UPDATE invitation SET status = 'accepted' WHERE id = $1`, [id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (createdUserId) await this.conn.pool.query(`DELETE FROM "user" WHERE id = $1`, [createdUserId]);
      throw error;
    } finally {
      client.release();
    }
  }

  private async createVerifiedUser(email: string, { name, password }: z.infer<typeof newAccountSchema>) {
    const ctx = await this.auth.$context;
    const user = await ctx.internalAdapter.createUser({ email, name, emailVerified: true }, { method: 'email-password' });
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: await ctx.password.hash(password),
    });
    return user.id;
  }

  private async maxUsers(tenantId: string): Promise<number> {
    const [subscription] = await withTenant(this.db, tenantId, (tx) => tx.select({ plan: subscriptions.plan }).from(subscriptions));
    return planLimits(subscription?.plan ?? 'trial').maxUsers;
  }

  private async find(id: string): Promise<InvitationRow> {
    const { rows } = await this.conn.pool.query<InvitationRow>(
      `SELECT i.id, i."organizationId", o.name AS "organizationName", i.email, i.role, i.status, i."expiresAt"
       FROM invitation i JOIN organization o ON o.id = i."organizationId" WHERE i.id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }

  private isUsable(invitation: Pick<InvitationRow, 'status' | 'expiresAt'>): boolean {
    return invitation.status === 'pending' && invitation.expiresAt.getTime() > Date.now();
  }

  private assertUsable(invitation: Pick<InvitationRow, 'status' | 'expiresAt'>) {
    if (!this.isUsable(invitation)) {
      throw new AppError(HttpStatus.GONE, 'INVITATION_NO_LONGER_VALID', 'La invitación venció, fue cancelada o ya se usó.');
    }
  }
}
