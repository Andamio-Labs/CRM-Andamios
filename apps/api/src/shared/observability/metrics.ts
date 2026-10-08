import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Headers, Inject, Injectable, type NestMiddleware, Res, UnauthorizedException } from '@nestjs/common';
import type { Env } from '../../config/env.js';
import { ENV } from '../tokens.js';
import type { NextFunction, Request, Response } from 'express';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

/** Registro propio por instancia de la app (no el global): los tests levantan varias apps. */
@Injectable()
export class Metrics {
  readonly registry = new Registry();

  readonly requests = new Counter({
    name: 'http_requests_total',
    help: 'Requests HTTP por método, patrón de ruta y status',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });

  readonly duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Latencia HTTP por método, patrón de ruta y status',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }
}

/**
 * La etiqueta `route` es el PATRÓN (/api/v1/members/:id), nunca la URL real:
 * con la URL, cada id crea una serie nueva y Prometheus explota (cardinalidad).
 */
export function routeLabel(req: Request): string {
  if (req.originalUrl.startsWith('/api/auth/')) return '/api/auth/*';
  const pattern = req.route?.path;
  // Un patrón con comodín es el catch-all de Nest (404), no una ruta real de la app.
  if (typeof pattern === 'string' && !pattern.includes('*')) return `${req.baseUrl ?? ''}${pattern}`;
  return 'unmatched';
}

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: Metrics) {}

  use(req: Request, res: Response, next: NextFunction) {
    const stop = this.metrics.duration.startTimer();
    res.on('finish', () => {
      const labels = { method: req.method, route: routeLabel(req), status: String(res.statusCode) };
      this.metrics.requests.inc(labels);
      stop(labels);
    });
    next();
  }
}

/** Prometheus lo raspea en local (docker compose --profile observability). En la nube: solo red interna. */
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: Metrics,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  async scrape(@Res() res: Response, @Headers('authorization') authorization?: string) {
    if (this.env.METRICS_TOKEN && !sameSecret(authorization ?? '', `Bearer ${this.env.METRICS_TOKEN}`)) throw new UnauthorizedException();
    res.type(this.metrics.registry.contentType).send(await this.metrics.registry.metrics());
  }
}

/** Comparación en tiempo constante: no filtra el token por tiempos de respuesta. */
export function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
