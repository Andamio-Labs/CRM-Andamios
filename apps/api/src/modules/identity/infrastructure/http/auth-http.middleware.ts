import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../../../../config/env.js';
import { AUTH, ENV } from '../../../../shared/tokens.js';
import { RateLimiter } from '../../../../shared/http/security.js';
import { LoginThrottle } from '../../domain/login-throttle.js';
import type { Auth } from '../auth.js';

const SIGN_IN_PATH = '/api/auth/sign-in/email';
/**
 * Equipo e invitaciones van SOLO por /api/v1/members|invitations, donde aplican la matriz
 * de permisos y el cupo del plan. Las rutas de organización de Better Auth quedan cerradas
 * (allowlist: cualquier ruta nueva que agregue una versión futura también nace cerrada).
 */
const BLOCKED_PREFIXES = ['/api/auth/organization/', '/api/auth/sign-up/']; // sign-up: solo vía /api/v1/registrations
/** Auditoría #4: rutas de auth expuestas a fuerza bruta o spam de correos, limitadas por IP. */
const RATE_LIMITED = ['/api/auth/sign-in/', '/api/auth/request-password-reset', '/api/auth/send-verification-email'];

/**
 * Puente Express → Better Auth (/api/auth/*).
 * Lo hacemos a mano (Request web → auth.handler → Response) en lugar de toNodeHandler para
 * controlar el antes y el después del login: así aplicamos el bloqueo por intentos (E01-S02)
 * sin depender de detalles internos de Better Auth.
 */
@Injectable()
export class AuthHttpMiddleware implements NestMiddleware {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(ENV) private readonly env: Env,
    private readonly throttle: LoginThrottle,
    private readonly limiter: RateLimiter,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    try {
      const path = req.originalUrl.split('?')[0]!;
      if (BLOCKED_PREFIXES.some((p) => path.startsWith(p))) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Not Found' });
        return;
      }
      if (req.method === 'POST' && RATE_LIMITED.some((p) => path.startsWith(p)) && !(await this.limiter.allow('auth', req, res))) return;
      const email = this.signInEmail(req);
      if (email && (await this.throttle.isLocked(email))) {
        res.status(429).json({
          code: 'ACCOUNT_TEMPORARILY_LOCKED',
          message: `Por seguridad bloqueamos la cuenta por ${this.throttle.lockMinutes} minutos tras varios intentos fallidos.`,
        });
        return;
      }

      const response = await this.auth.handler(toWebRequest(req, this.env.API_URL));

      if (email) {
        if (response.status === 401) await this.throttle.registerFailure(email);
        else if (response.ok) await this.throttle.registerSuccess(email);
      }
      await sendWebResponse(res, response);
    } catch (error) {
      next(error);
    }
  }

  private signInEmail(req: Request): string | null {
    const isSignIn = req.method === 'POST' && req.originalUrl.split('?')[0] === SIGN_IN_PATH;
    return isSignIn && typeof req.body?.email === 'string' ? req.body.email : null;
  }
}

function toWebRequest(req: Request, baseUrl: string): globalThis.Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key === 'content-length') continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
  }
  const hasBody = !['GET', 'HEAD'].includes(req.method) && req.body && Object.keys(req.body).length > 0;
  if (hasBody) headers.set('content-type', 'application/json');
  return new Request(new URL(req.originalUrl, baseUrl), {
    method: req.method,
    headers,
    body: hasBody ? JSON.stringify(req.body) : undefined,
  });
}

async function sendWebResponse(res: Response, response: globalThis.Response) {
  res.status(response.status);
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') res.setHeader(key, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader('set-cookie', cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}
