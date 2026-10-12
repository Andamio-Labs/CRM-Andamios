import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_URL, createTeam, createTestApp, type TestApp } from './support/test-app.js';

// PNG de 1×1 px: la API revisa la firma del archivo, no solo la extensión.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Perfil personal: datos, foto y "Mi actividad" en la empresa activa. */
describe('Mi perfil', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;

  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Perfil SAS');
  });
  afterAll(() => t.close());

  const profile = async () => (await team.owner.api.get('/api/v1/me/profile').expect(200)).body;
  const upload = (buffer: Buffer, name: string) => team.owner.agent.post('/api/v1/me/avatar').set('Origin', APP_URL).attach('file', buffer, name);

  it('trae mis datos de cuenta, mi rol y desde cuándo estoy en el equipo', async () => {
    const me = await profile();
    expect(me).toMatchObject({
      id: team.owner.userId, name: 'Dueña', email: team.owner.email, emailVerified: true,
      position: null, phone: null, address: null, bio: null, avatarUrl: null,
      role: 'owner', companyName: 'Perfil SAS',
    });
    expect(Date.parse(me.memberSince)).toBeGreaterThan(0);
  });

  it('guarda cargo, teléfono, dirección y "sobre mí"', async () => {
    const body = { position: 'Gerente comercial', phone: '+57 300 123 4567', address: 'Calle 10 # 5-20, Bogotá', bio: 'Atiendo de 8 a 5.' };
    await team.owner.api.patch('/api/v1/me/profile', body).expect(200);
    expect(await profile()).toMatchObject(body);
    await team.owner.api.patch('/api/v1/me/profile', { position: '' }).expect(200);
    expect((await profile()).position).toBeNull();
  });

  it('valida los límites', async () => {
    await team.owner.api.patch('/api/v1/me/profile', { bio: 'a'.repeat(1001) }).expect(400);
    await team.owner.api.patch('/api/v1/me/profile', { email: 'otro@x.co' }).expect(400);
  });

  it('el perfil es de cada persona', async () => {
    expect((await team.seller.api.get('/api/v1/me/profile').expect(200)).body).toMatchObject({ position: null, role: 'member' });
  });

  it('sube la foto, la muestra con URL firmada y la puede quitar', async () => {
    const url = (await upload(PNG, 'yo.png').expect(200)).body.avatarUrl as string;
    expect(url).toContain('signature=');
    expect((await profile()).avatarUrl).toContain('signature=');
    await team.owner.api.del('/api/v1/me/avatar').expect(204);
    expect((await profile()).avatarUrl).toBeNull();
  });

  it('rechaza archivos que no son imágenes aunque digan .png', async () => {
    expect((await upload(Buffer.from('no soy una imagen'), 'falsa.png').expect(400)).body.code).toBe('INVALID_IMAGE');
  });

  it('"Mi actividad" cuenta mis negocios, tareas, recordatorios y conversaciones, y lista mis acciones recientes', async () => {
    const pipeline = (await team.owner.api.get('/api/v1/pipelines').expect(200)).body[0];
    await team.owner.api.post('/api/v1/deals', { title: 'Andamios torre norte', pipelineId: pipeline.id, ownerId: team.owner.userId }).expect(201);
    const contactId = (await team.owner.api.post('/api/v1/contacts', { name: 'Cliente actividad' }).expect(201)).body.id;
    const inOneHour = new Date(Date.now() + 2 * 60_000).toISOString();
    const yesterday = new Date(Date.now() - 26 * 60 * 60_000).toISOString();
    await team.owner.api.post('/api/v1/tasks', { title: 'Llamar hoy', contactId, assigneeId: team.owner.userId, dueAt: inOneHour, remindBeforeMinutes: 10 }).expect(201);
    await team.owner.api.post('/api/v1/tasks', { title: 'Atrasada', contactId, assigneeId: team.owner.userId, dueAt: yesterday }).expect(201);

    const activity = (await team.owner.api.get('/api/v1/me/activity').expect(200)).body;
    expect(activity.deals).toMatchObject({ open: 1, wonThisMonth: 0 });
    expect(activity.tasks).toMatchObject({ open: 2, overdue: 1 });
    expect(activity.reminders.today).toBeGreaterThanOrEqual(1);
    expect(activity.conversations).toMatchObject({ open: 0, unread: 0 });
    expect(activity.recent[0]).toMatchObject({ dealTitle: 'Andamios torre norte', type: 'created' });
  });
});
