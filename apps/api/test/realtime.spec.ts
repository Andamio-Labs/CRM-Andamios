import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_URL, createTeam, createTestApp, STRONG_PASSWORD, type TestApp } from './support/test-app.js';

/** E03-S02 — Mover un negocio se refleja en tiempo real para otros usuarios (WebSocket). */
describe('Tiempo real del Kanban (E03-S02)', () => {
  let t: TestApp;
  let baseUrl: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.listen(0);
    baseUrl = `http://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await t.close();
  });

  /** Inicia sesión y devuelve la cookie de sesión, como la mandaría el navegador. */
  async function cookieOf(member: { email: string }) {
    const res = await t.http().post('/api/auth/sign-in/email').set('Origin', APP_URL).send({ email: member.email, password: STRONG_PASSWORD }).expect(200);
    return ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
  }

  function connect(cookie: string | null, origin = APP_URL): Promise<Socket> {
    const socket = io(`${baseUrl}/realtime`, {
      path: '/api/socket.io',
      transports: ['websocket'],
      extraHeaders: { ...(cookie ? { cookie } : {}), origin },
      reconnection: false,
    });
    sockets.push(socket);
    return new Promise((resolve, reject) => {
      socket.on('ready', () => resolve(socket));
      socket.on('connect_error', reject);
      socket.on('disconnect', () => reject(new Error('desconectado por el servidor')));
    });
  }

  const nextEvent = (socket: Socket, name: string, ms = 3000) =>
    new Promise<Record<string, unknown> | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), ms);
      socket.once(name, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  it('otro usuario del equipo recibe el movimiento al instante', async () => {
    const team = await createTeam(t, 'Realtime SA');
    const pipeline = (await team.owner.api.get('/api/v1/pipelines')).body[0];
    const deal = (await team.owner.api.post('/api/v1/deals', { title: 'Vivo', pipelineId: pipeline.id }).expect(201)).body;

    const adminSocket = await connect(await cookieOf(team.admin));
    const received = nextEvent(adminSocket, 'deal.moved');
    await team.owner.api.post(`/api/v1/deals/${deal.id}/move`, { stageId: pipeline.stages[2].id }).expect(200);
    expect(await received).toMatchObject({ dealId: deal.id, pipelineId: pipeline.id, stageId: pipeline.stages[2].id });
  });

  it('otra empresa NO recibe el evento', async () => {
    const a = await createTeam(t, 'Empresa A');
    const b = await createTeam(t, 'Empresa B');
    const pipeline = (await a.owner.api.get('/api/v1/pipelines')).body[0];
    const deal = (await a.owner.api.post('/api/v1/deals', { title: 'Secreto', pipelineId: pipeline.id }).expect(201)).body;

    const outsider = await connect(await cookieOf(b.owner));
    const leak = nextEvent(outsider, 'deal.moved', 800);
    await a.owner.api.post(`/api/v1/deals/${deal.id}/move`, { stageId: pipeline.stages[1].id }).expect(200);
    expect(await leak).toBeNull();
  });

  it('vendedor con la regla activa solo recibe eventos de SUS negocios', async () => {
    const team = await createTeam(t, 'Visibles');
    await team.owner.api.patch('/api/v1/tenant/settings', { sellersSeeOnlyAssigned: true }).expect(200);
    const pipeline = (await team.owner.api.get('/api/v1/pipelines')).body[0];
    const others = (await team.owner.api.post('/api/v1/deals', { title: 'Ajeno', pipelineId: pipeline.id }).expect(201)).body;
    const mine = (await team.owner.api.post('/api/v1/deals', { title: 'Mío', pipelineId: pipeline.id, ownerId: team.seller.userId }).expect(201)).body;

    const sellerSocket = await connect(await cookieOf(team.seller));
    const notMine = nextEvent(sellerSocket, 'deal.moved', 800);
    await team.owner.api.post(`/api/v1/deals/${others.id}/move`, { stageId: pipeline.stages[1].id }).expect(200);
    expect(await notMine).toBeNull();

    const own = nextEvent(sellerSocket, 'deal.moved');
    await team.owner.api.post(`/api/v1/deals/${mine.id}/move`, { stageId: pipeline.stages[1].id }).expect(200);
    expect(await own).toMatchObject({ dealId: mine.id });
  });

  const disconnected = (socket: Socket, ms = 3000) =>
    new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      socket.once('disconnect', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });

  it('al quitar a un miembro del equipo se corta su conexión en vivo (auditoría #1)', async () => {
    const team = await createTeam(t, 'Bajas');
    const sellerSocket = await connect(await cookieOf(team.seller));
    const cut = disconnected(sellerSocket);
    await team.owner.api.del(`/api/v1/members/${team.seller.memberId}`).expect(204);
    expect(await cut).toBe(true);
  });

  it('al activar "solo lo asignado" se reconectan los vendedores y pierden la sala general (auditoría #2)', async () => {
    const team = await createTeam(t, 'Cambio de regla');
    const sellerSocket = await connect(await cookieOf(team.seller));
    const ownerSocket = await connect(await cookieOf(team.owner));
    const sellerCut = disconnected(sellerSocket);
    const ownerCut = disconnected(ownerSocket, 800);
    await team.owner.api.patch('/api/v1/tenant/settings', { sellersSeeOnlyAssigned: true }).expect(200);
    expect(await sellerCut).toBe(true);
    expect(await ownerCut).toBe(false); // el propietario siempre ve todo: no hace falta cortarlo
  });

  it('rechaza conexiones sin sesión', async () => {
    await expect(connect(null)).rejects.toThrow();
  });

  it('rechaza conexiones desde otro origen (cross-site WebSocket hijacking)', async () => {
    const team = await createTeam(t, 'Origen');
    await expect(connect(await cookieOf(team.owner), 'https://sitio-malicioso.com')).rejects.toThrow();
  });
});
