import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  HttpStatus,
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
import { AppError } from '../../../../shared/http/app-error.js';
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
  /** Estado efectivo de la suscripción (E10-S02): una prueba vencida ya es `read_only`. */
  accountStatus: string;
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

const ALLOW_READ_ONLY_KEY = 'allowWhenReadOnly';
/** La ruta modifica datos pero debe funcionar en solo lectura: pagar, eliminar la empresa, derechos del titular. */
export const AllowWhenReadOnly = () => SetMetadata(ALLOW_READ_ONLY_KEY, true);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
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
    const { rows } = await this.conn.pool.query<{ role: Role; account: string | null }>(
      `SELECT role, account_status("organizationId") AS account FROM member WHERE "userId" = $1 AND "organizationId" = $2`,
      [result.user.id, tenantId],
    );
    if (!rows[0]) throw new UnauthorizedException();
    const accountStatus = rows[0].account ?? 'trialing';

    // E10-S02 — Solo lectura: se lee y se exporta todo; no se modifica nada salvo lo explícitamente permitido.
    if ((accountStatus === 'read_only' || accountStatus === 'canceled') && !SAFE_METHODS.has(req.method)
      && !this.reflector.getAllAndOverride<boolean>(ALLOW_READ_ONLY_KEY, [context.getHandler(), context.getClass()])) {
      throw new AppError(HttpStatus.PAYMENT_REQUIRED, 'ACCOUNT_READ_ONLY', 'Tu cuenta está en solo lectura. Activa un plan para seguir trabajando; tus datos están intactos.');
    }

    req.auth = { userId: result.user.id, email: result.user.email, tenantId, role: rows[0].role, accountStatus };
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
    // Falla cerrado (E13-S07): una ruta sin @RequirePermission es un olvido, no un permiso para todos.
    const role = context.switchToHttp().getRequest<AuthedRequest>().auth?.role;
    if (!action || !role || !can(role, action)) throw new ForbiddenException('No tienes permiso para esta acción');
    return true;
  }
}

export const CurrentAuth = createParamDecorator((_: unknown, context: ExecutionContext): AuthContext => {
  const auth = context.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new UnauthorizedException();
  return auth;
});
