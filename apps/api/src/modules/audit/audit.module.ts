import { type CallHandler, Controller, type ExecutionContext, Get, Inject, Injectable, Logger, Module, type NestInterceptor, UseGuards } from '@nestjs/common';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { and, desc, eq, gte, lt, lte, or, type SQL, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { mergeMap, type Observable } from 'rxjs';
import { z } from 'zod';
import type { Database } from '../../shared/database/database.js';
import { auditLog } from '../../shared/database/schema.js';
import { withTenant } from '../../shared/database/with-tenant.js';
import { AUDIT_VIEW_KEY, NO_AUDIT_KEY } from '../../shared/http/audit.js';
import { badRequest } from '../../shared/http/errors.js';
import { ZodQuery } from '../../shared/http/zod-validation.pipe.js';
import { DB } from '../../shared/tokens.js';
import { IdentityModule } from '../identity/identity.module.js';
import { type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const METHOD_ACTION: Record<string, string> = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };

/**
 * Qué se hizo, a partir del patrón de la ruta: `/api/v1/deals/:id/move` → entidad "deals", acción "move".
 * Sin acción con nombre, sale del método HTTP.
 */
export function describeRoute(method: string, routePath: string) {
  const segments = routePath.replace(/^.*?\/v1\//, '').split('/').filter(Boolean);
  const firstParam = segments.findIndex((s) => s.startsWith(':'));
  const entity = (firstParam === -1 ? segments : segments.slice(0, firstParam)).join('/');
  const tail = segments.at(-1);
  const action = firstParam !== -1 && tail && !tail.startsWith(':') && segments.length - 1 > firstParam ? tail : METHOD_ACTION[method] ?? method.toLowerCase();
  return { entity, action };
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async record(auth: AuthContext, entry: { action: string; entity: string; entityId: string | null; data: Record<string, unknown>; ip: string | null }) {
    await withTenant(this.db, auth.tenantId, (tx) => tx.insert(auditLog).values({ tenantId: auth.tenantId, actorId: auth.userId, ...entry }))
      .catch((error: Error) => this.logger.error(`No se pudo auditar ${entry.action} ${entry.entity}: ${error.message}`));
  }

  list(auth: AuthContext, q: z.infer<typeof auditQuerySchema>) {
    return withTenant(this.db, auth.tenantId, async (tx) => {
      const filters: (SQL | undefined)[] = [
        q.actorId ? eq(auditLog.actorId, q.actorId) : undefined,
        q.action ? eq(auditLog.action, q.action) : undefined,
        q.entity ? eq(auditLog.entity, q.entity) : undefined,
        q.entityId ? eq(auditLog.entityId, q.entityId) : undefined,
        q.from ? gte(auditLog.createdAt, new Date(q.from)) : undefined,
        q.to ? lte(auditLog.createdAt, new Date(q.to)) : undefined,
      ];
      if (q.cursor) {
        const [at, id] = decode(q.cursor);
        filters.push(or(lt(auditLog.createdAt, at), and(eq(auditLog.createdAt, at), lt(auditLog.id, id))));
      }
      const rows = await tx.select({
        id: auditLog.id, action: auditLog.action, entity: auditLog.entity, entityId: auditLog.entityId, actorId: auditLog.actorId,
        actorName: sql<string | null>`(SELECT name FROM "user" WHERE id = ${auditLog.actorId})`, data: auditLog.data, ip: auditLog.ip, createdAt: auditLog.createdAt,
      }).from(auditLog).where(and(...filters)).orderBy(desc(auditLog.createdAt), desc(auditLog.id)).limit(q.limit + 1);
      const items = rows.slice(0, q.limit);
      const last = items.at(-1);
      return { items, nextCursor: rows.length > q.limit && last ? encode(last.createdAt, last.id) : null };
    });
  }
}

export const auditQuerySchema = z.object({
  actorId: z.string().max(64).optional(),
  action: z.string().max(40).optional(),
  entity: z.string().max(60).optional(),
  entityId: z.string().max(64).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});

const encode = (at: Date, id: number) => Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
function decode(cursor: string): [Date, number] {
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!at || !id || Number.isNaN(Date.parse(at)) || !/^\d+$/.test(id)) throw badRequest('Cursor inválido');
  return [new Date(at), Number(id)];
}

/** Registra cada mutación exitosa y cada vista marcada con @AuditView, antes de responder. */
@Injectable()
class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    const targets = [context.getHandler(), context.getClass()];
    const isView = this.reflector.getAllAndOverride<boolean>(AUDIT_VIEW_KEY, targets);
    const mutating = !SAFE_METHODS.has(req.method);
    if (context.getType() !== 'http' || !req.route?.path || this.reflector.getAllAndOverride<boolean>(NO_AUDIT_KEY, targets) || (!mutating && !isView)) {
      return next.handle();
    }
    return next.handle().pipe(mergeMap(async (response: unknown) => {
      if (req.auth) {
        const { entity, action } = describeRoute(req.method, req.route.path);
        const responseId = response && typeof response === 'object' && 'id' in response ? String((response as { id: unknown }).id) : null;
        const fields = mutating && req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? Object.keys(req.body).slice(0, 50) : undefined;
        await this.audit.record(req.auth, {
          action: isView && !mutating ? 'view' : action, entity, entityId: typeof req.params.id === 'string' ? req.params.id : responseId,
          data: { method: req.method, route: req.route.path, ...(fields ? { fields } : {}) }, ip: req.ip ?? null,
        });
      }
      return response;
    }));
  }
}

@Controller('v1/audit')
@UseGuards(SessionGuard, PermissionGuard)
class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get() @RequirePermission('audit:read')
  list(@CurrentAuth() auth: AuthContext, @ZodQuery(auditQuerySchema) query: z.infer<typeof auditQuerySchema>) { return this.audit.list(auth, query); }
}

/** E13-S06 — Registro de auditoría append-only: la app no puede editarlo ni borrarlo (REVOKE en 0008). */
@Module({
  imports: [IdentityModule],
  controllers: [AuditController],
  providers: [AuditService, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
})
export class AuditModule {}
