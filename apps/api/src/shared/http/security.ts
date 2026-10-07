import {
  type ArgumentsHost, Catch, HttpStatus, Inject, Injectable, type NestMiddleware,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../../config/env.js';
import type { AttemptStore } from '../../modules/identity/domain/login-throttle.js';
import { ATTEMPT_STORE, ENV } from '../tokens.js';
import { pgErrorCode } from './errors.js';

/**
 * Auditoría #5 — CSRF: las cookies SameSite=Lax ya frenan casi todo; además, una mutación
 * cuyo Origin (o Referer) no es la app se rechaza. Sin ambos headers no es un navegador: pasa.
 */
@Injectable()
export class OriginCheckMiddleware implements NestMiddleware {
  constructor(@Inject(ENV) private readonly env: Env) {}

  use(req: Request, res: Response, next: NextFunction) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin ?? (req.headers.referer ? new URL(req.headers.referer).origin : undefined);
    if (origin && origin !== this.env.APP_URL) {
      res.status(HttpStatus.FORBIDDEN).json({ code: 'FORBIDDEN_ORIGIN', message: 'Origen no permitido' });
      return;
    }
    next();
  }
}

/**
 * Auditoría #4 — Rate limit por IP y grupo de rutas (ventana fija de 60 s).
 * Reusa el mismo puerto que el bloqueo de login: Valkey en runtime, memoria en tests.
 */
@Injectable()
export class RateLimiter {
  constructor(
    @Inject(ATTEMPT_STORE) private readonly store: AttemptStore,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** true si la request puede seguir; si no, responde 429 con Retry-After. */
  async allow(group: string, req: Request, res: Response): Promise<boolean> {
    const hits = await this.store.increment(`rl:${group}:${req.ip}`, 60);
    if (hits <= this.env.RATE_LIMIT_PUBLIC_PER_MINUTE) return true;
    res.setHeader('Retry-After', '60');
    res.status(HttpStatus.TOO_MANY_REQUESTS).json({ code: 'RATE_LIMITED', message: 'Demasiados intentos. Espera un minuto.' });
    return false;
  }
}

@Injectable()
export class PublicRateLimitMiddleware implements NestMiddleware {
  constructor(private readonly limiter: RateLimiter) {}

  async use(req: Request, res: Response, next: NextFunction) {
    try {
      if (await this.limiter.allow('public', req, res)) next();
    } catch (error) {
      next(error);
    }
  }
}

/**
 * Auditoría #3 — Errores de Postgres que vienen de input del cliente nunca deben ser 500:
 * 22P02 (texto inválido, p. ej. uuid mal formado) → 400, 23505 → 409, 23503 → 409.
 */
@Catch()
export class PostgresErrorFilter extends BaseExceptionFilter {
  override catch(error: unknown, host: ArgumentsHost) {
    const mapped = { '22P02': [400, 'INVALID_INPUT', 'Dato con formato inválido'], '23505': [409, 'ALREADY_EXISTS', 'El registro ya existe'], '23503': [409, 'IN_USE', 'El registro está en uso o referencia algo inexistente'] }[pgErrorCode(error) ?? ''];
    if (mapped && host.getType() === 'http') {
      const [status, code, message] = mapped as [number, string, string];
      host.switchToHttp().getResponse<Response>().status(status).json({ code, message });
      return;
    }
    super.catch(error, host);
  }
}
