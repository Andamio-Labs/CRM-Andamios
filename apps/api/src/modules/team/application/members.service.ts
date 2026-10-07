import { ForbiddenException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type pg from 'pg';
import { z } from 'zod';
import { AppError } from '../../../shared/http/app-error.js';
import { RealtimeGateway } from '../../../shared/realtime/realtime.gateway.js';
import { PG_POOL } from '../../../shared/tokens.js';
import type { Role } from '../../identity/domain/roles.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';

export const changeRoleSchema = z.object({ role: z.enum(['admin', 'member']) }).strict();
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

export interface MemberView {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  createdAt: Date;
}

/** E01-S04 — Gestión del equipo con las reglas que la matriz sola no expresa (docs/permissions.md). */
@Injectable()
export class MembersService {
  constructor(
    @Inject(PG_POOL) private readonly conn: { pool: pg.Pool },
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(tenantId: string): Promise<MemberView[]> {
    const { rows } = await this.conn.pool.query<MemberView>(
      `SELECT m.id, m."userId", u.name, u.email, m.role, m."createdAt"
       FROM member m JOIN "user" u ON u.id = m."userId"
       WHERE m."organizationId" = $1 ORDER BY m."createdAt"`,
      [tenantId],
    );
    return rows;
  }

  async changeRole(auth: AuthContext, memberId: string, { role }: ChangeRoleInput): Promise<MemberView> {
    const target = await this.findInTenant(auth.tenantId, memberId);
    if (target.userId === auth.userId) {
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'CANNOT_CHANGE_OWN_ROLE', 'No puedes cambiar tu propio rol.');
    }
    if (target.role === 'owner') {
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'OWNER_IMMUTABLE', 'El rol del propietario no se puede cambiar.');
    }
    await this.conn.pool.query(`UPDATE member SET role = $1 WHERE id = $2`, [role, memberId]);
    this.realtime.disconnectUser(auth.tenantId, target.userId); // el rol cambia lo que ve en vivo
    return { ...target, role };
  }

  async remove(auth: AuthContext, memberId: string): Promise<void> {
    const target = await this.findInTenant(auth.tenantId, memberId);
    if (auth.role === 'admin' && target.role !== 'member') {
      throw new ForbiddenException('Un admin solo puede quitar vendedores.');
    }
    if (target.role === 'owner') {
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'OWNER_IMMUTABLE', 'El propietario no se puede quitar de la empresa.');
    }
    const client = await this.conn.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM member WHERE id = $1`, [memberId]);
      await client.query(`DELETE FROM session WHERE "userId" = $1 AND "activeOrganizationId" = $2`, [target.userId, auth.tenantId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    this.realtime.disconnectUser(auth.tenantId, target.userId); // auditoría #1
  }

  /** 404 también para miembros de OTRA empresa: no confirmamos que existan. */
  private async findInTenant(tenantId: string, memberId: string): Promise<MemberView> {
    const { rows } = await this.conn.pool.query<MemberView>(
      `SELECT m.id, m."userId", u.name, u.email, m.role, m."createdAt"
       FROM member m JOIN "user" u ON u.id = m."userId"
       WHERE m.id = $1 AND m."organizationId" = $2`,
      [memberId, tenantId],
    );
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }
}
