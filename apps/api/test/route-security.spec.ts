import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { type ExecutionContext, ForbiddenException, RequestMethod } from '@nestjs/common';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PermissionGuard, SessionGuard } from '../src/modules/identity/infrastructure/http/session.guard.js';
import { createTestApp, type TestApp } from './support/test-app.js';

/**
 * E13-S07 — Inventario de rutas. Los guards se declaran por controller y PermissionGuard deja pasar
 * si falta @RequirePermission: un controller nuevo sin decoradores quedaría abierto sin que nada falle.
 * Cada ruta tiene que estar protegida (sesión + permiso) o figurar aquí, con el motivo.
 */
const PUBLIC_ROUTES: Record<string, string> = {
  'GET /health': 'chequeo de salud del balanceador',
  'GET /metrics': 'Prometheus; METRICS_TOKEN obligatorio en producción',
  'GET /internal/activation-funnel': 'agregados de plataforma; exige METRICS_TOKEN',
  'GET /v1/legal': 'textos legales vigentes, se leen antes de registrarse',
  'POST /v1/registrations': 'alta de empresa; rate limit por IP',
  'GET /v1/invitations/:id': 'ver la invitación antes de aceptarla; rate limit por IP',
  'POST /v1/invitations/:id/accept': 'aceptar la invitación; rate limit por IP',
  'GET /media/*key': 'archivos con URL firmada de corta duración',
  'GET /l/:code': 'enlace corto de anuncios; rate limit por IP',
  'GET /webhooks/whatsapp': 'verificación de Meta con META_VERIFY_TOKEN',
  'POST /webhooks/whatsapp': 'eventos de Meta; firma HMAC',
  'POST /webhooks/wompi': 'eventos de Wompi; checksum con el secreto de eventos',
};

interface Route { key: string; guards: unknown[]; permission: unknown }

function collectRoutes(t: TestApp): Route[] {
  const routes: Route[] = [];
  for (const module of t.app.get(ModulesContainer).values()) {
    for (const { metatype } of module.controllers.values()) {
      if (typeof metatype !== 'function') continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, metatype) ?? '').replace(/^\/|\/$/g, '');
      const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, metatype) ?? [];
      for (const name of Object.getOwnPropertyNames(metatype.prototype)) {
        const handler = metatype.prototype[name];
        if (name === 'constructor' || typeof handler !== 'function' || Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        const path = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '').replace(/^\/|\/$/g, '');
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
        routes.push({
          key: `${method} /${[base, path].filter(Boolean).join('/')}`,
          guards: [...classGuards, ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? [])],
          permission: Reflect.getMetadata('permission', handler) ?? Reflect.getMetadata('permission', metatype),
        });
      }
    }
  }
  return routes;
}

describe('Inventario de rutas (E13-S07)', () => {
  let t: TestApp;
  let routes: Route[];

  beforeAll(async () => {
    t = await createTestApp();
    routes = collectRoutes(t);
  });
  afterAll(() => t.close());

  it('encuentra las rutas de la app', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it('toda ruta no pública exige sesión y un permiso explícito', () => {
    const open = routes
      .filter((r) => !(r.key in PUBLIC_ROUTES))
      .filter((r) => !r.guards.includes(SessionGuard) || !r.guards.includes(PermissionGuard) || !r.permission)
      .map((r) => r.key);
    expect(open).toEqual([]);
  });

  it('PermissionGuard falla cerrado: una ruta sin @RequirePermission no deja pasar a nadie', () => {
    class Unannotated { handler() {} }
    const context = {
      getHandler: () => Unannotated.prototype.handler,
      getClass: () => Unannotated,
      switchToHttp: () => ({ getRequest: () => ({ auth: { role: 'owner' } }) }),
    } as unknown as ExecutionContext;
    expect(() => new PermissionGuard(new Reflector()).canActivate(context)).toThrow(ForbiddenException);
  });

  it('la lista de rutas públicas no tiene entradas viejas', () => {
    const keys = new Set(routes.map((r) => r.key));
    expect(Object.keys(PUBLIC_ROUTES).filter((k) => !keys.has(k))).toEqual([]);
  });
});
