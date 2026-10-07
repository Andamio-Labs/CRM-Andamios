import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BullJobQueue, type JobHandler, WorkerHost } from '../src/shared/queue/bull-queue.js';

/** E15-S05 — Colas con reintentos exponenciales y cola de mensajes fallidos (DLQ). */
describe('Colas y workers (E15-S05)', () => {
  let valkey: StartedTestContainer;
  let connection: { host: string; port: number };
  const hosts: WorkerHost[] = [];
  const queues: BullJobQueue[] = [];

  beforeAll(async () => {
    valkey = await new GenericContainer('valkey/valkey:8-alpine').withExposedPorts(6379).start();
    connection = { host: valkey.getHost(), port: valkey.getMappedPort(6379) };
  });
  afterAll(async () => {
    await Promise.all([...hosts.map((h) => h.close()), ...queues.map((q) => q.close())]);
    await valkey?.stop();
  });

  function setup(handlers: Record<string, JobHandler>, opts = { attempts: 3, backoffMs: 20 }) {
    const queue = new BullJobQueue(connection, { prefix: `t${Math.random().toString(36).slice(2)}`, ...opts });
    const host = new WorkerHost(connection, queue.prefix, handlers);
    queues.push(queue);
    hosts.push(host);
    return { queue, host };
  }

  // 15 s: bajo carga (turbo corre web y API en paralelo) BullMQ puede tardar en promover trabajos.
  const until = async (check: () => Promise<boolean> | boolean, ms = 15_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('timeout esperando la condición');
  };

  it('procesa un trabajo en segundo plano', async () => {
    const done: unknown[] = [];
    const { queue } = setup({ 'mail.send': async (data) => void done.push(data) });
    await queue.enqueue('mail', 'mail.send', { to: 'ana@x.co' });
    await until(() => done.length === 1);
    expect(done[0]).toEqual({ to: 'ana@x.co' });
  });

  it('reintenta con backoff exponencial y termina bien', async () => {
    const attempts: number[] = [];
    // Base de 150 ms: con menos, el jitter del scheduler de BullMQ tapa la curva exponencial.
    const { queue } = setup({
      flaky: async () => {
        attempts.push(Date.now());
        if (attempts.length < 3) throw new Error('Meta devolvió 503');
      },
    }, { attempts: 3, backoffMs: 150 });
    await queue.enqueue('webhooks', 'flaky', {});
    await until(() => attempts.length === 3);
    const gaps = [attempts[1]! - attempts[0]!, attempts[2]! - attempts[1]!];
    // Solo cotas inferiores: la carga puede RETRASAR un reintento, nunca adelantarlo.
    expect(gaps[0]).toBeGreaterThanOrEqual(140); // 150 ms
    expect(gaps[1]).toBeGreaterThanOrEqual(290); // 300 ms: se duplicó
  });

  it('agotados los intentos, el trabajo va a la cola de fallidos con el error', async () => {
    const { queue, host } = setup({ broken: async () => { throw new Error('token de Meta vencido'); } });
    await queue.enqueue('webhooks', 'broken', { messageId: 'wamid.1' });
    await until(async () => (await host.deadLetters()).length === 1);
    const [dead] = await host.deadLetters();
    expect(dead).toMatchObject({ queue: 'webhooks', name: 'broken', data: { messageId: 'wamid.1' }, error: 'token de Meta vencido', attempts: 3 });
  });

  it('con jobId es idempotente: el mismo webhook no se procesa dos veces', async () => {
    const seen: unknown[] = [];
    const { queue } = setup({ 'wa.inbound': async (data) => void seen.push(data) });
    await queue.enqueue('webhooks', 'wa.inbound', { id: 'wamid.X' }, { jobId: 'wamid.X' });
    await queue.enqueue('webhooks', 'wa.inbound', { id: 'wamid.X' }, { jobId: 'wamid.X' });
    await until(() => seen.length >= 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(seen).toHaveLength(1);
  });

  it('un trabajo sin handler va directo a fallidos (no se pierde en silencio)', async () => {
    const { queue, host } = setup({});
    await queue.enqueue('mail', 'desconocido', {});
    await until(async () => (await host.deadLetters()).length === 1);
  });
});
