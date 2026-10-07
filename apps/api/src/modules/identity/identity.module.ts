import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Env } from '../../config/env.js';
import type { Mailer } from '../../shared/mail/mailer.js';
import { ATTEMPT_STORE, AUTH, ENV, MAILER, PG_POOL } from '../../shared/tokens.js';
import { LegalModule } from '../legal/legal.module.js';
import { RegisterCompany } from './application/register-company.js';
import { type AttemptStore, LoginThrottle } from './domain/login-throttle.js';
import { createAuth } from './infrastructure/auth.js';
import { AuthHttpMiddleware } from './infrastructure/http/auth-http.middleware.js';
import { RegistrationsController } from './infrastructure/http/registrations.controller.js';
import { PermissionGuard, SessionGuard, SessionResolver } from './infrastructure/http/session.guard.js';
import { ValkeyAttemptStore } from './infrastructure/valkey-attempt-store.js';
import { PublicRateLimitMiddleware, RateLimiter } from '../../shared/http/security.js';

@Module({
  imports: [LegalModule],
  controllers: [RegistrationsController],
  providers: [
    {
      provide: ATTEMPT_STORE,
      inject: [ENV],
      useFactory: (env: Env) => new ValkeyAttemptStore(new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 })),
    },
    { provide: LoginThrottle, inject: [ATTEMPT_STORE], useFactory: (store: AttemptStore) => new LoginThrottle(store) },
    {
      provide: AUTH,
      inject: [PG_POOL, ENV, MAILER],
      useFactory: (conn: { pool: import('pg').Pool }, env: Env, mailer: Mailer) => createAuth({ pool: conn.pool, env, mailer }),
    },
    RegisterCompany,
    RateLimiter,
    SessionResolver,
    SessionGuard,
    PermissionGuard,
  ],
  exports: [AUTH, ATTEMPT_STORE, SessionResolver, SessionGuard, PermissionGuard, RateLimiter],
})
export class IdentityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthHttpMiddleware).forRoutes({ path: 'auth/*path', method: RequestMethod.ALL });
    consumer.apply(PublicRateLimitMiddleware).forRoutes(
      { path: 'v1/registrations', method: RequestMethod.POST },
      { path: 'v1/invitations/:id', method: RequestMethod.GET },
      { path: 'v1/invitations/:id/accept', method: RequestMethod.POST },
      { path: 'l/:code', method: RequestMethod.GET },
    );
  }
}
