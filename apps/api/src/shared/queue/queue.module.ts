import { Global, Inject, Logger, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { Env } from '../../config/env.js';
import { SmtpMailer } from '../mail/smtp-mailer.js';
import { ENV, JOB_QUEUE } from '../tokens.js';
import { BullJobQueue, connectionFromUrl, InlineJobQueue, type JobHandler, type JobQueue, WorkerHost } from './bull-queue.js';

export const JOB_HANDLERS = Symbol('JOB_HANDLERS');

/**
 * E15-S05 — Colas. QUEUE_DRIVER=bullmq usa Valkey; "inline" ejecuta en el acto (tests).
 * WORKERS=inline levanta los workers dentro de la API (cómodo en desarrollo);
 * en producción la API usa WORKERS=off y los procesa src/worker.ts.
 */
@Global()
@Module({
  providers: [
    {
      provide: JOB_HANDLERS,
      inject: [ENV],
      useFactory: (env: Env): Record<string, JobHandler> => {
        const smtp = new SmtpMailer({ host: env.SMTP_HOST, port: env.SMTP_PORT, from: env.MAIL_FROM });
        return { 'mail.send': (message) => smtp.send(message) };
      },
    },
    {
      provide: JOB_QUEUE,
      inject: [ENV, JOB_HANDLERS],
      useFactory: (env: Env, handlers: Record<string, JobHandler>): JobQueue =>
        env.QUEUE_DRIVER === 'inline' ? new InlineJobQueue(handlers) : new BullJobQueue(connectionFromUrl(env.REDIS_URL)),
    },
  ],
  exports: [JOB_QUEUE, JOB_HANDLERS],
})
export class QueueModule implements OnModuleInit, OnApplicationShutdown {
  private host?: WorkerHost;
  private readonly logger = new Logger('Workers');

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(JOB_HANDLERS) private readonly handlers: Record<string, JobHandler>,
  ) {}

  onModuleInit() {
    if (this.env.WORKERS === 'on' && this.env.QUEUE_DRIVER === 'bullmq') {
      this.host = new WorkerHost(connectionFromUrl(this.env.REDIS_URL), 'beecrm', this.handlers, (msg, e) => this.logger.error(msg, e));
      this.logger.log('Workers activos: mail, webhooks, ai, outbound');
    }
  }

  async onApplicationShutdown() {
    await this.host?.close();
    await this.queue.close();
  }
}
