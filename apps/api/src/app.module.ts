import { Controller, Get, Global, type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { loadEnv } from './config/env.js';
import { ContactsModule } from './modules/contacts/contacts.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { AutomationModule } from './modules/automation/automation.module.js';
import { BillingModule } from './modules/billing/plan.service.js';
import { LegalModule } from './modules/legal/legal.module.js';
import { MarketingModule } from './modules/marketing/marketing.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { PipelineModule } from './modules/pipeline/pipeline.module.js';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module.js';
import { TeamModule } from './modules/team/team.module.js';
import { TenancyModule } from './modules/tenancy/tenancy.module.js';
import { DatabaseModule } from './shared/database/database.module.js';
import { DomainEventsModule } from './shared/events/domain-events.js';
import { OriginCheckMiddleware } from './shared/http/security.js';
import { MailModule } from './shared/mail/mail.module.js';
import { RealtimeModule } from './shared/realtime/realtime.gateway.js';
import { StorageModule } from './shared/storage/storage.module.js';
import { QueueModule } from './shared/queue/queue.module.js';
import { ObservabilityModule } from './shared/observability/observability.module.js';
import { ENV } from './shared/tokens.js';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
class ConfigModule {}

@Controller('health')
class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}

/** Monolito modular: cada módulo de /modules es un bounded context (screaming architecture). */
@Module({
  imports: [ConfigModule, ObservabilityModule, DatabaseModule, QueueModule, MailModule, DomainEventsModule, StorageModule, BillingModule, IdentityModule, TenancyModule, TeamModule, ContactsModule, PipelineModule, RealtimeModule, LegalModule, WhatsAppModule, TasksModule, AutomationModule, MarketingModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(OriginCheckMiddleware).forRoutes({ path: 'v1/*path', method: RequestMethod.ALL });
  }
}
