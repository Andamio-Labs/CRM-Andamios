import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { Database } from '../../shared/database/database.js';
import { subscriptions } from '../../shared/database/schema.js';
import { withTenant } from '../../shared/database/with-tenant.js';
import { AppError } from '../../shared/http/app-error.js';
import { AUTH, DB, ENV, PG_POOL } from '../../shared/tokens.js';
import { planLimits } from '../billing/domain/plans.js';
import { provisionTenant, slugify } from '../identity/application/register-company.js';
import { can } from '../identity/domain/permissions.js';
import type { Role } from '../identity/domain/roles.js';
import type { Auth } from '../identity/infrastructure/auth.js';
import type { AuthContext } from '../identity/infrastructure/http/session.guard.js';
import { NotificationsService } from '../tasks/notifications.service.js';

export const companyNameSchema = z.object({ name: z.string().trim().min(2).max(120) }).strict();
export const joinSchema = z.object({ code: z.string().trim().min(4).max(20) }).strict();

interface MembershipRow { id: string; name: string; createdAt: Date; role: Role }

function toHeaders(raw: IncomingHttpHeaders) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) if (typeof value === 'string') headers.set(key, value);
  return headers;
}

/**
 * E01-S10 — Multiempresa: una persona puede estar en varias empresas y elegir la activa.
 * Unirse con el código crea una solicitud que aprueba el equipo; nunca da acceso directo.
 */
@Injectable()
export class CompaniesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PG_POOL) private readonly conn: { pool: pg.Pool },
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(ENV) private readonly env: Env,
    private readonly notifications: NotificationsService,
  ) {}

  async list(auth: AuthContext) {
    const { rows } = await this.conn.pool.query<MembershipRow>(
      `SELECT o.id, o.name, o."createdAt", m.role FROM member m JOIN organization o ON o.id = m."organizationId"
       WHERE m."userId" = $1 ORDER BY m."createdAt"`,
      [auth.userId],
    );
    // Pocas empresas por persona: una transacción corta por cada una, con su propio RLS.
    return Promise.all(rows.map((c) => withTenant(this.db, c.id, async (tx) => {
      const { rows: [info] } = await tx.execute<{ joinCode: string; currency: string; funnel: boolean; configured: boolean }>(sql`
        SELECT s.join_code AS "joinCode", s.currency,
               EXISTS (SELECT 1 FROM pipelines) AS funnel,
               (EXISTS (SELECT 1 FROM tenant_onboarding WHERE pipeline_chosen_at IS NOT NULL)
                OR EXISTS (SELECT 1 FROM whatsapp_channels WHERE status = 'connected')) AS configured
        FROM tenant_settings s`);
      return {
        id: c.id,
        name: c.name,
        role: c.role,
        active: c.id === auth.tenantId,
        // El código sirve para sumar gente: solo lo ve quien puede invitar.
        joinCode: can(c.role, 'members:invite') ? (info?.joinCode ?? null) : null,
        currency: info?.currency ?? 'COP',
        createdAt: c.createdAt,
        crmConfigured: Boolean(info?.configured),
        funnelCreated: Boolean(info?.funnel),
      };
    })));
  }

  /** Crea la empresa con la persona como propietaria, la deja lista (prueba + embudo) y la activa. */
  async create(auth: AuthContext, name: string, headers: IncomingHttpHeaders) {
    const org = await this.auth.api.createOrganization({ body: { name, slug: slugify(name), userId: auth.userId } });
    if (!org) throw new Error('No se pudo crear la organización');
    try {
      await withTenant(this.db, org.id, (tx) => provisionTenant(tx, org.id, this.env.TRIAL_DAYS));
    } catch (error) {
      await this.conn.pool.query(`DELETE FROM organization WHERE id = $1`, [org.id]);
      throw error;
    }
    await this.auth.api.setActiveOrganization({ headers: toHeaders(headers), body: { organizationId: org.id } });
    return { id: org.id };
  }

  async activate(auth: AuthContext, id: string, headers: IncomingHttpHeaders) {
    const { rowCount } = await this.conn.pool.query(`SELECT 1 FROM member WHERE "userId" = $1 AND "organizationId" = $2`, [auth.userId, id]);
    if (!rowCount) throw new NotFoundException();
    await this.auth.api.setActiveOrganization({ headers: toHeaders(headers), body: { organizationId: id } });
  }

  async rename(auth: AuthContext, name: string) {
    await this.conn.pool.query(`UPDATE organization SET name = $1 WHERE id = $2`, [name, auth.tenantId]);
  }

  async join(auth: AuthContext, code: string) {
    const { rows: [r] } = await this.conn.pool.query<{ outcome: string; id: string | null; tenant_id: string | null; company_name: string | null; created_at: Date | null }>(
      `SELECT * FROM request_to_join($1, $2)`,
      [code, auth.userId],
    );
    if (r!.outcome === 'not_found') throw new AppError(HttpStatus.NOT_FOUND, 'JOIN_CODE_NOT_FOUND', 'No encontramos una empresa con ese código. Revísalo con quien te lo envió.');
    if (r!.outcome === 'member') throw new AppError(HttpStatus.CONFLICT, 'ALREADY_MEMBER', 'Ya eres parte de esa empresa.');
    if (r!.outcome === 'requested') throw new AppError(HttpStatus.CONFLICT, 'ALREADY_REQUESTED', 'Ya enviaste una solicitud a esa empresa. Espera a que el equipo la revise.');

    const { rows: [who] } = await this.conn.pool.query<{ name: string }>(`SELECT name FROM "user" WHERE id = $1`, [auth.userId]);
    const { rows: managers } = await this.conn.pool.query<{ userId: string }>(
      `SELECT "userId" FROM member WHERE "organizationId" = $1 AND role IN ('owner', 'admin')`,
      [r!.tenant_id],
    );
    await this.notifications.notify(r!.tenant_id!, managers.map((m) => m.userId), {
      type: 'join_request',
      title: `${who?.name ?? 'Alguien'} quiere unirse a ${r!.company_name}`,
      body: 'Revisa la solicitud en Equipo para aprobarla o rechazarla.',
      link: '/team',
    });
    return { id: r!.id!, companyName: r!.company_name!, status: 'pending' as const, createdAt: r!.created_at! };
  }

  async myRequests(auth: AuthContext) {
    const { rows } = await this.conn.pool.query<{ id: string; company_name: string; status: string; created_at: Date; decided_at: Date | null }>(
      `SELECT * FROM my_join_requests($1)`,
      [auth.userId],
    );
    return rows.map((r) => ({ id: r.id, companyName: r.company_name, status: r.status, createdAt: r.created_at, decidedAt: r.decided_at }));
  }

  async cancelMyRequest(auth: AuthContext, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    const { rows: [r] } = await this.conn.pool.query<{ canceled: boolean }>(`SELECT cancel_my_join_request($1, $2) AS canceled`, [id, auth.userId]);
    if (!r?.canceled) throw new NotFoundException();
  }

  /** Solicitudes pendientes de la empresa activa, para quien puede invitar. */
  pending(auth: AuthContext) {
    return withTenant(this.db, auth.tenantId, async (tx) => {
      const { rows } = await tx.execute<{ id: string; userId: string; name: string; email: string; status: string; createdAt: Date }>(sql`
        SELECT r.id, r.user_id AS "userId", u.name, u.email, r.status, r.created_at AS "createdAt"
        FROM join_requests r JOIN "user" u ON u.id = r.user_id
        WHERE r.status = 'pending' ORDER BY r.created_at`);
      return rows;
    });
  }

  /** Entra como vendedor. Respeta el cupo del plan con el mismo candado que las invitaciones. */
  async approve(auth: AuthContext, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    const [subscription] = await withTenant(this.db, auth.tenantId, (tx) => tx.select({ plan: subscriptions.plan }).from(subscriptions));
    const maxUsers = planLimits(subscription?.plan ?? 'trial').maxUsers;
    await withTenant(this.db, auth.tenantId, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`seats:${auth.tenantId}`}))`);
      const { rows: [request] } = await tx.execute<{ userId: string }>(sql`
        SELECT user_id AS "userId" FROM join_requests WHERE id = ${id} AND status = 'pending' FOR UPDATE`);
      if (!request) throw new NotFoundException();
      const { rows: [seats] } = await tx.execute<{ used: number }>(sql`
        SELECT (SELECT count(*) FROM member WHERE "organizationId" = ${auth.tenantId})
             + (SELECT count(*) FROM invitation WHERE "organizationId" = ${auth.tenantId}
                AND status = 'pending' AND "expiresAt" > now()) AS used`);
      if (Number(seats!.used) >= maxUsers) {
        throw new AppError(HttpStatus.CONFLICT, 'PLAN_USER_LIMIT_REACHED', `Tu plan permite ${maxUsers} usuarios (incluye invitaciones pendientes). Mejora tu plan para sumar más.`);
      }
      await tx.execute(sql`
        INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
        SELECT ${randomBytes(16).toString('hex')}, ${auth.tenantId}, ${request.userId}, 'member', now()
        WHERE NOT EXISTS (SELECT 1 FROM member WHERE "organizationId" = ${auth.tenantId} AND "userId" = ${request.userId})`);
      await tx.execute(sql`UPDATE join_requests SET status = 'approved', decided_by = ${auth.userId}, decided_at = now() WHERE id = ${id}`);
    });
  }

  async reject(auth: AuthContext, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    const updated = await withTenant(this.db, auth.tenantId, (tx) => tx.execute(sql`
      UPDATE join_requests SET status = 'rejected', decided_by = ${auth.userId}, decided_at = now()
      WHERE id = ${id} AND status = 'pending' RETURNING id`));
    if (!updated.rows.length) throw new NotFoundException();
  }
}
