import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { Env } from '../../config/env.js';

/** Todo lo que pueda ser una credencial se oculta ANTES de escribir el log. */
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.accessToken',
  '*.secret',
];

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Respeta el x-request-id del cliente solo si es seguro (evita inyección en logs); si no, genera uno. */
export function requestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', id);
  return id;
}

/**
 * E15-S03 — Logs JSON estructurados: una línea por request con reqId, ruta, status, duración
 * y (cuando hay sesión) tenantId/userId. En desarrollo se ven bonitos con pino-pretty.
 */
export function loggerOptions(env: Env): Params {
  return {
    assignResponse: true,
    pinoHttp: {
      level: env.NODE_ENV === 'test' ? 'silent' : (env.LOG_LEVEL ?? 'info'),
      genReqId: requestId,
      redact: { paths: REDACT_PATHS, censor: '[REDACTADO]' },
      autoLogging: { ignore: (req) => ['/api/health', '/api/metrics'].includes(req.url ?? '') },
      customLogLevel: (_req, res, error) => (error || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
    },
  };
}
