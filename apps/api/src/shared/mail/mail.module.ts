import { Global, Module } from '@nestjs/common';
import type { JobQueue } from '../queue/bull-queue.js';
import { JOB_QUEUE, MAILER } from '../tokens.js';
import type { Mailer, MailMessage } from './mailer.js';

/** El correo sale por la cola: si el SMTP falla, se reintenta y no bloquea la request. */
class QueuedMailer implements Mailer {
  constructor(private readonly queue: JobQueue) {}

  send(message: MailMessage) {
    return this.queue.enqueue('mail', 'mail.send', message);
  }
}

@Global()
@Module({
  providers: [{ provide: MAILER, inject: [JOB_QUEUE], useFactory: (queue: JobQueue) => new QueuedMailer(queue) }],
  exports: [MAILER],
})
export class MailModule {}
