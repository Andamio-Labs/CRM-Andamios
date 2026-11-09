import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_URL, createTeam, createTestApp, STRONG_PASSWORD, type TestApp } from './support/test-app.js';

interface Chat { id: string; kind: string; title: string; unread: number; dealTitle: string | null; members: { userId: string }[]; lastMessage: { body: string; authorName: string | null } | null }
interface Message { id: string; body: string; deleted: boolean; mine: boolean; canDelete: boolean; authorName: string | null }

/** E12-S03 — Chat interno del equipo: general, directos, grupos con negocio y notas personales. */
describe('Chat interno del equipo (E12-S03)', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  let baseUrl: string;
  const sockets: Socket[] = [];
  const chats = async (who: typeof team.owner) => (await who.api.get('/api/v1/team-chats').expect(200)).body as Chat[];
  const general = async (who: typeof team.owner) => (await chats(who)).find((c) => c.kind === 'general')!;
  const say = (who: typeof team.owner, chatId: string, body: string) => who.api.post(`/api/v1/team-chats/${chatId}/messages`, { body });
  const thread = async (who: typeof team.owner, chatId: string, query = '') =>
    (await who.api.get(`/api/v1/team-chats/${chatId}/messages${query}`).expect(200)).body as Message[];

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.listen(0);
    baseUrl = `http://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}`;
    team = await createTeam(t, 'Chat SAS');
  });
  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await t.close();
  });

  it('cada persona tiene el chat general de la empresa y sus notas personales', async () => {
    const mine = await chats(team.owner);
    expect(mine.map((c) => [c.kind, c.title])).toEqual([['general', 'General'], ['notes', 'Mis notas']]);
    expect((await general(team.seller)).id).toBe(mine[0]!.id);
    // Las notas son de cada uno.
    expect((await chats(team.seller)).find((c) => c.kind === 'notes')!.id).not.toBe(mine[1]!.id);
    await team.seller.api.get(`/api/v1/team-chats/${mine[1]!.id}/messages`).expect(404);
  });

  it('el general: lo que escribe uno llega como no leído a los demás, hasta que lo leen', async () => {
    const chat = await general(team.owner);
    await say(team.owner, chat.id, 'Buenos días, equipo').expect(201);
    expect((await general(team.seller)).unread).toBe(1);
    expect((await general(team.owner)).unread).toBe(0);
    expect((await general(team.seller)).lastMessage).toMatchObject({ body: 'Buenos días, equipo', authorName: 'Dueña' });
    await team.seller.api.post(`/api/v1/team-chats/${chat.id}/read`).expect(204);
    expect((await general(team.seller)).unread).toBe(0);
  });

  it('chat directo: siempre el mismo entre dos personas y privado para el resto', async () => {
    const direct = (await team.owner.api.post('/api/v1/team-chats', { userIds: [team.seller.userId] }).expect(201)).body as Chat;
    expect(direct).toMatchObject({ kind: 'direct', title: 'Nuevo member' });
    const again = (await team.seller.api.post('/api/v1/team-chats', { userIds: [team.owner.userId] }).expect(201)).body as Chat;
    expect(again.id).toBe(direct.id);
    expect(again.title).toBe('Dueña');

    await say(team.owner, direct.id, '¿Llamaste a Constructora El Roble?').expect(201);
    expect((await thread(team.seller, direct.id)).map((m) => m.body)).toEqual(['¿Llamaste a Constructora El Roble?']);
    await team.admin.api.get(`/api/v1/team-chats/${direct.id}/messages`).expect(404);
    await say(team.admin, direct.id, 'Me cuelo').expect(404);
    expect((await chats(team.admin)).some((c) => c.id === direct.id)).toBe(false);
  });

  it('grupo con negocio adjunto; solo con gente del equipo', async () => {
    const pipeline = (await team.owner.api.get('/api/v1/pipelines').expect(200)).body[0];
    const deal = (await team.owner.api.post('/api/v1/deals', { title: 'Torre B', pipelineId: pipeline.id }).expect(201)).body;
    const group = (await team.owner.api.post('/api/v1/team-chats', { userIds: [team.seller.userId, team.admin.userId], dealId: deal.id }).expect(201)).body as Chat;
    expect(group).toMatchObject({ kind: 'group', title: 'Torre B', dealTitle: 'Torre B' });
    expect(group.members).toHaveLength(3);
    await team.owner.api.post('/api/v1/team-chats', { userIds: ['ajeno'] }).expect(400);
    await team.owner.api.post('/api/v1/team-chats', { userIds: [team.owner.userId] }).expect(400);
  });

  it('cada quien borra sus mensajes, solo durante la primera hora', async () => {
    const chat = await general(team.owner);
    const sent = (await say(team.seller, chat.id, 'Mensaje con error').expect(201)).body;
    await team.owner.api.del(`/api/v1/team-chats/${chat.id}/messages/${sent.id}`).expect(403);
    await team.seller.api.del(`/api/v1/team-chats/${chat.id}/messages/${sent.id}`).expect(204);
    expect((await thread(team.owner, chat.id)).find((m) => m.id === sent.id)).toMatchObject({ deleted: true, body: '' });

    const old = (await say(team.seller, chat.id, 'Mensaje viejo').expect(201)).body;
    await t.owner.query(`UPDATE team_messages SET created_at = now() - interval '61 minutes' WHERE id = $1`, [old.id]);
    expect((await thread(team.seller, chat.id)).find((m) => m.id === old.id)?.canDelete).toBe(false);
    await team.seller.api.del(`/api/v1/team-chats/${chat.id}/messages/${old.id}`).expect(403);
  });

  it('pagina hacia atrás con "before"', async () => {
    const chat = (await chats(team.admin)).find((c) => c.kind === 'notes')!;
    for (const body of ['uno', 'dos', 'tres']) await say(team.admin, chat.id, body).expect(201);
    const last2 = await thread(team.admin, chat.id, '?limit=2');
    expect(last2.map((m) => m.body)).toEqual(['dos', 'tres']);
    const first = await t.owner.query(`SELECT created_at FROM team_messages WHERE body = 'dos' AND chat_id = $1`, [chat.id]);
    const older = await thread(team.admin, chat.id, `?before=${encodeURIComponent(first.rows[0].created_at.toISOString())}`);
    expect(older.map((m) => m.body)).toEqual(['uno']);
  });

  it('avisa en vivo solo a los miembros, sin mandar el contenido', async () => {
    const cookie = async (email: string) => {
      const res = await t.http().post('/api/auth/sign-in/email').set('Origin', APP_URL).send({ email, password: STRONG_PASSWORD }).expect(200);
      return ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
    };
    const connect = (c: string) => new Promise<Socket>((resolve, reject) => {
      const socket = io(`${baseUrl}/realtime`, { path: '/api/socket.io', transports: ['websocket'], extraHeaders: { cookie: c, origin: APP_URL }, reconnection: false });
      sockets.push(socket);
      socket.on('ready', () => resolve(socket));
      socket.on('connect_error', reject);
    });
    const next = (socket: Socket) => new Promise<Record<string, unknown> | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 1500);
      socket.once('team.message', (payload) => { clearTimeout(timer); resolve(payload); });
    });

    const direct = (await team.owner.api.post('/api/v1/team-chats', { userIds: [team.seller.userId] }).expect(201)).body as Chat;
    const seller = await connect(await cookie(team.seller.email));
    const admin = await connect(await cookie(team.admin.email));
    const toSeller = next(seller);
    const toAdmin = next(admin);
    await say(team.owner, direct.id, 'Privado').expect(201);
    expect(await toSeller).toEqual({ chatId: direct.id });
    expect(await toAdmin).toBeNull();
  });

  it('otra empresa no ve ni escribe en los chats', async () => {
    const chat = await general(team.owner);
    const other = await createTeam(t, 'Otra del chat');
    await other.owner.api.get(`/api/v1/team-chats/${chat.id}/messages`).expect(404);
    await say(other.owner, chat.id, 'Hola').expect(404);
    expect((await general(other.owner)).id).not.toBe(chat.id);
  });
});
