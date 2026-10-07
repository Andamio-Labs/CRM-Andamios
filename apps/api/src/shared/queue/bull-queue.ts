import { type ConnectionOptions, type Job, Queue, UnrecoverableError, Worker } from 'bullmq';

/** Colas del sistema. webhooks/ai/outbound las usan E04 y E05. */
export const QUEUE_NAMES = ['mail', 'webhooks', 'ai', 'outbound', 'imports', 'system'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];
const DEAD_LETTER = 'dead-letter';

export type JobHandler = (data: any, job: Job) => Promise<void>;

/** Puerto: encolar trabajo asíncrono. `jobId` hace la operación idempotente (p. ej. id del webhook). */
export interface JobQueue {
  enqueue(queue: QueueName, name: string, data: unknown, opts?: { jobId?: string; delayMs?: number }): Promise<void>;
  /** Trabajo periódico (barridos). Uno solo en todo el clúster aunque haya varios workers. */
  schedule(name: string, everyMs: number): Promise<void>;
  close(): Promise<void>;
}

export function connectionFromUrl(url: string): ConnectionOptions {
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 6379), password: u.password || undefined, db: Number(u.pathname.slice(1) || 0) };
}

/** E15-S05 — BullMQ sobre Valkey: reintentos con backoff exponencial y retención acotada. */
export class BullJobQueue implements JobQueue {
  private readonly queues = new Map<string, Queue>();
  readonly prefix: string;

  constructor(
    private readonly connection: ConnectionOptions,
    private readonly opts: { prefix?: string; attempts?: number; backoffMs?: number } = {},
  ) {
    this.prefix = opts.prefix ?? 'beecrm';
  }

  async enqueue(queue: QueueName, name: string, data: unknown, opts: { jobId?: string; delayMs?: number } = {}) {
    // Auditoría #8: los correos llevan enlaces con tokens; no quedan guardados después de enviarse.
    const retention = queue === 'mail' ? { removeOnComplete: true } : {};
    await this.queue(queue).add(name, data, { jobId: opts.jobId, delay: opts.delayMs, ...retention });
  }

  async schedule(name: string, everyMs: number) {
    await this.queue('system').upsertJobScheduler(name, { every: everyMs }, { name });
  }

  async close() {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }

  private queue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: this.connection,
        prefix: this.prefix,
        defaultJobOptions: {
          attempts: this.opts.attempts ?? 5,
          backoff: { type: 'exponential', delay: this.opts.backoffMs ?? 2000 },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        },
      });
      this.queues.set(name, queue);
    }
    return queue;
  }
}

/**
 * Procesa las colas con los handlers registrados. Cuando un trabajo agota sus intentos
 * (o no tiene handler), se copia a `dead-letter` con el error: nada se pierde en silencio.
 */
export class WorkerHost {
  private readonly workers: Worker[];
  private readonly dlq: Queue;

  constructor(
    connection: ConnectionOptions,
    prefix: string,
    handlers: Record<string, JobHandler>,
    onError: (message: string, error: unknown) => void = () => {},
  ) {
    this.dlq = new Queue(DEAD_LETTER, { connection, prefix });
    this.workers = QUEUE_NAMES.map((queue) => {
      const worker = new Worker(
        queue,
        async (job) => {
          const handler = handlers[job.name];
          if (!handler) throw new UnrecoverableError(`No hay handler para "${job.name}"`);
          await handler(job.data, job);
        },
        { connection, prefix, concurrency: 5 },
      );
      worker.on('failed', (job, error) => {
        if (!job) return;
        const final = error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
        if (!final) return;
        this.dlq
          .add(job.name, { queue, name: job.name, data: job.data, error: error.message, attempts: job.attemptsMade, failedAt: new Date().toISOString() })
          .catch((e) => onError('No se pudo mover el trabajo a dead-letter', e));
      });
      worker.on('error', (e) => onError(`Error del worker "${queue}"`, e));
      return worker;
    });
  }

  async deadLetters() {
    return (await this.dlq.getJobs(['waiting', 'delayed'])).map((j) => j.data);
  }

  async close() {
    await Promise.all([...this.workers.map((w) => w.close()), this.dlq.close()]);
  }
}

/** Para tests: ejecuta el handler en el acto, sin Valkey. */
export class InlineJobQueue implements JobQueue {
  constructor(private readonly handlers: Record<string, JobHandler>) {}

  async enqueue(_queue: QueueName, name: string, data: unknown) {
    await this.handlers[name]?.(data, {} as Job);
  }

  /** En tests los barridos se llaman a mano. */
  async schedule() {}

  async close() {}
}
