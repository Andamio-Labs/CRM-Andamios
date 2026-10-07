import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IncomingHttpHeaders } from 'node:http';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import type pg from 'pg';
import { AUTH, PG_POOL } from '../../../../shared/tokens.js';
import { type Action, can } from '../../domain/permissions.js';
import type { Role } from '../../domain/roles.js';
import type { Auth } from '../auth.js';

/** Quién hace la request y en qué tenant. Lo resuelve SessionGuard. */
export interface AuthContext {
  userId: string;
  email: string;
  tenantId: string;
  role: Role;
}

type AuthedRequest = Request & { auth?: AuthContext };

/** Lee la sesión de Better Auth desde los headers de Express. Null si no hay sesión válida. */
@Injectable()
export class SessionResolver {
  constructor(@Inject(AUTH) private readonly auth: Auth) {}

  resolve(req: Request) {
    return this.resolveHeaders(req.headers);
  }

  async resolveHeaders(raw: IncomingHttpHeaders) {
    const headers = new Headers();
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string') headers.set(key, value);
    }
    return this.auth.api.getSession({ headers });
  }
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionResolver,
    @Inject(PG_POOL) private readonly conn: { pool: pg.Pool },
    @Optional() private readonly logger?: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const result = await this.sessions.resolve(req);
    const tenantId = result?.session.activeOrganizationId;
    if (!result || !tenantId) throw new UnauthorizedException();

    // La membresía se consulta en CADA request: si te quitan del equipo, perdés acceso al instante.
    const { rows } = await this.conn.pool.query<{ role: Role }>(
      `SELECT role FROM member WHERE "userId" = $1 AND "organizationId" = $2`,
      [result.user.id, tenantId],
    );
    if (!rows[0]) throw new UnauthorizedException();

    req.auth = { userId: result.user.id, email: result.user.email, tenantId, role: rows[0].role };
    this.logger?.assign({ tenantId, userId: result.user.id });
    return true;
  }
}

const PERMISSION_KEY = 'permission';
/** Exige un permiso de la matriz (docs/permissions.md). Va DESPUÉS de SessionGuard. */
export const RequirePermission = (action: Action) => SetMetadata(PERMISSION_KEY, action);

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const action = this.reflector.getAllAndOverride<Action | undefined>(PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (!action) return true;
    const role = context.switchToHttp().getRequest<AuthedRequest>().auth?.role;
    if (!role || !can(role, action)) throw new ForbiddenException('No tienes permiso para esta acción');
    return true;
  }
}

export const CurrentAuth = createParamDecorator((_: unknown, context: ExecutionContext): AuthContext => {
  const auth = context.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new UnauthorizedException();
  return auth;
});
