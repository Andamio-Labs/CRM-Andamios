import { Global, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { Env } from '../../config/env.js';
import { ENV } from '../tokens.js';
import { loggerOptions } from './logger.js';
import { HttpMetricsMiddleware, Metrics, MetricsController } from './metrics.js';

/** E15-S03 — Logs estructurados + métricas. Va PRIMERO en AppModule para medir también /api/auth/*. */
@Global()
@Module({
  imports: [LoggerModule.forRootAsync({ inject: [ENV], useFactory: (env: Env) => loggerOptions(env) })],
  controllers: [MetricsController],
  providers: [Metrics],
  exports: [Metrics],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HttpMetricsMiddleware).forRoutes('*path');
  }
}
