import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTeam, createTestApp, type TestApp } from './support/test-app.js';

interface Meeting { id: string; joinUrl: string; startsAt: string; title: string }

/** E12-S03 — Reuniones online: inmediatas, programadas, calendario, acta, grabación y cancelación. */
describe('Reuniones (E12-S03)', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  let dealId: string;
  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  const ids = async (api: typeof team.owner.api, query = '') => ((await api.get(`/api/v1/meetings${query}`).expect(200)).body as Meeting[]).map((m) => m.id);

  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Reuniones SAS');
    const pipeline = (await team.owner.api.get('/api/v1/pipelines').expect(200)).body[0];
    dealId = (await team.owner.api.post('/api/v1/deals', { title: 'Negocio con reunión', pipelineId: pipeline.id }).expect(201)).body.id;
  });
  afterAll(() => t.close());

  it('reunión inmediata: abre una sala nueva con enlace imposible de adivinar y aparece en próximas', async () => {
    const meeting = (await team.owner.api.post('/api/v1/meetings', { title: 'Reunión rápida' }).expect(201)).body;
    expect(meeting.joinUrl).toMatch(/^https:\/\/meet\.jit\.si\/BeeCRM-[0-9a-f]{24}$/);
    expect(Date.parse(meeting.startsAt)).toBeLessThanOrEqual(Date.now());
    expect(meeting).toMatchObject({ organizerName: 'Dueña', canManage: true, participants: [] });
    expect(await ids(team.owner.api)).toContain(meeting.id);
  });

  it('programada con colegas, invitados y negocio: avisa a los colegas y manda el enlace a los de afuera', async () => {
    const meeting = (await team.owner.api.post('/api/v1/meetings', {
      title: 'Demo con el cliente', startsAt: inHours(2), durationMinutes: 30, agenda: 'Precios y entrega',
      participantIds: [team.seller.userId], guestEmails: ['Cliente@Externo.co'], dealId,
    }).expect(201)).body;
    expect(meeting).toMatchObject({
      dealId, dealTitle: 'Negocio con reunión', guestEmails: ['cliente@externo.co'],
      participants: [{ userId: team.seller.userId, name: 'Nuevo member' }],
    });
    expect(Date.parse(meeting.endsAt) - Date.parse(meeting.startsAt)).toBe(30 * 60_000);

    const bell = (await team.seller.api.get('/api/v1/notifications').expect(200)).body.items;
    expect(bell.some((n: { type: string; title: string; link: string }) => n.type === 'meeting_invite' && n.title.includes('Demo con el cliente') && n.link === `/meetings?m=${meeting.id}`)).toBe(true);
    expect(t.mailer.lastLinkTo('cliente@externo.co')).toBe(meeting.joinUrl);

    // Cada persona ve las reuniones que organiza o a las que la invitaron.
    expect(await ids(team.seller.api)).toContain(meeting.id);
    expect(await ids(team.admin.api)).not.toContain(meeting.id);
    expect((await team.seller.api.get(`/api/v1/meetings/${meeting.id}`).expect(200)).body.title).toBe('Demo con el cliente');
    await team.admin.api.get(`/api/v1/meetings/${meeting.id}`).expect(404);
    await team.admin.api.get('/api/v1/meetings/no-es-un-id').expect(404);
    expect((await team.seller.api.get('/api/v1/meetings').expect(200)).body.find((m: Meeting) => m.id === meeting.id).canManage).toBe(false);
  });

  it('acepta un enlace propio solo con https y solo colegas del equipo', async () => {
    const own = (await team.owner.api.post('/api/v1/meetings', { title: 'Por Meet', joinUrl: 'https://meet.google.com/abc-defg-hij' }).expect(201)).body;
    expect(own.joinUrl).toBe('https://meet.google.com/abc-defg-hij');
    await team.owner.api.post('/api/v1/meetings', { title: 'X', joinUrl: 'javascript:alert(1)' }).expect(400);
    await team.owner.api.post('/api/v1/meetings', { title: 'X', joinUrl: 'http://sin-cifrar.co/sala' }).expect(400);
    await team.owner.api.post('/api/v1/meetings', { title: 'X', participantIds: ['ajeno'] }).expect(400);
    await team.owner.api.post('/api/v1/meetings', { title: '' }).expect(400);
  });

  it('pasadas y calendario por rango; cualquier participante completa el acta y la grabación', async () => {
    const past = (await team.owner.api.post('/api/v1/meetings', {
      title: 'Seguimiento semanal', startsAt: inHours(-3), durationMinutes: 60, participantIds: [team.seller.userId],
    }).expect(201)).body;
    expect(await ids(team.owner.api, '?scope=past')).toContain(past.id);
    expect(await ids(team.owner.api)).not.toContain(past.id);
    expect(await ids(team.owner.api, `?scope=range&from=${encodeURIComponent(inHours(-24))}&to=${encodeURIComponent(inHours(24))}`)).toContain(past.id);
    await team.owner.api.get('/api/v1/meetings?scope=range').expect(400);

    const updated = (await team.seller.api.patch(`/api/v1/meetings/${past.id}`, {
      minutes: 'Acordamos enviar la cotización el lunes.', recordingUrl: 'https://drive.google.com/file/d/123/view',
    }).expect(200)).body;
    expect(updated).toMatchObject({ minutes: 'Acordamos enviar la cotización el lunes.', recordingUrl: 'https://drive.google.com/file/d/123/view' });
    expect(await ids(team.owner.api, '?scope=minutes')).toContain(past.id);
    expect(await ids(team.owner.api, '?scope=recordings')).toContain(past.id);

    await team.seller.api.patch(`/api/v1/meetings/${past.id}`, { recordingUrl: 'http://sin-cifrar.co/video' }).expect(400);
    await team.seller.api.patch(`/api/v1/meetings/${past.id}`, { startsAt: inHours(1) }).expect(400);
    await team.admin.api.patch(`/api/v1/meetings/${past.id}`, { minutes: 'Intruso' }).expect(404);

    // Un acta vacía no cuenta como acta.
    await team.seller.api.patch(`/api/v1/meetings/${past.id}`, { minutes: '  ' }).expect(200);
    expect(await ids(team.owner.api, '?scope=minutes')).not.toContain(past.id);
  });

  it('cancelar: solo quien organiza (o un admin); avisa a los colegas y a los invitados', async () => {
    const meeting = (await team.owner.api.post('/api/v1/meetings', {
      title: 'Revisión de contrato', startsAt: inHours(5), participantIds: [team.seller.userId], guestEmails: ['abogada@externo.co'],
    }).expect(201)).body;

    await team.seller.api.del(`/api/v1/meetings/${meeting.id}`).expect(403);
    await team.owner.api.del(`/api/v1/meetings/${meeting.id}`).expect(204);

    const bell = (await team.seller.api.get('/api/v1/notifications').expect(200)).body.items;
    expect(bell.some((n: { title: string }) => n.title === 'Se canceló: Revisión de contrato')).toBe(true);
    expect(t.mailer.sent.findLast((m) => m.to === 'abogada@externo.co')?.subject).toMatch(/^Cancelada: Revisión de contrato/);
    expect(await ids(team.seller.api)).not.toContain(meeting.id);
  });

  it('otra empresa no ve ni toca las reuniones', async () => {
    const meeting = (await team.owner.api.post('/api/v1/meetings', { title: 'Privada' }).expect(201)).body;
    const other = (await createTeam(t, 'Otra de reuniones')).owner.api;
    expect(await ids(other)).toEqual([]);
    await other.patch(`/api/v1/meetings/${meeting.id}`, { minutes: 'x' }).expect(404);
    await other.del(`/api/v1/meetings/${meeting.id}`).expect(404);
    await other.post('/api/v1/meetings', { title: 'Con negocio ajeno', dealId }).expect(404);
  });
});
