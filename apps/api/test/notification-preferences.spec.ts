import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TasksService } from '../src/modules/tasks/tasks.service.js';
import { createTeam, createTestApp, type TestApp } from './support/test-app.js';

/** E14-S04 — Notificaciones in-app y por correo configurables por tipo de evento. */
describe('Preferencias de notificaciones (E14-S04)', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  let contactId: string;

  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Avisos SAS');
    contactId = (await team.owner.api.post('/api/v1/contacts', { name: 'Cliente avisos' }).expect(201)).body.id;
  });
  afterAll(() => t.close());

  async function remindSeller(title: string) {
    await team.owner.api.post('/api/v1/tasks', { title, contactId, assigneeId: team.seller.userId, dueAt: new Date(Date.now() + 5 * 60_000).toISOString(), remindBeforeMinutes: 10 }).expect(201);
    await t.app.get(TasksService).sendDueReminders();
  }
  const sellerMails = (title: string) => t.mailer.sent.filter((m) => m.to === team.seller.email && m.subject.includes(title));
  const sellerBell = async () => (await team.seller.api.get('/api/v1/notifications').expect(200)).body as { items: { title: string }[]; unread: number };

  it('cada tipo arranca con app, correo y push activos; el correo de cobros no se puede apagar', async () => {
    const prefs = (await team.seller.api.get('/api/v1/notifications/preferences').expect(200)).body;
    expect(prefs.map((p: { type: string }) => p.type)).toEqual(['task_reminder', 'meeting_invite', 'no_reply', 'sla_breach', 'deal_won', 'ai_handoff', 'ai_quota', 'join_request', 'billing']);
    expect(prefs.every((p: { inApp: boolean; email: boolean; push: boolean }) => p.inApp && p.email && p.push)).toBe(true);
    expect(prefs.find((p: { type: string }) => p.type === 'billing')).toMatchObject({ emailLocked: true, important: true });
    expect(prefs[0].label).toBeTruthy();
    expect(prefs[0].description).toBeTruthy();
  });

  it('sin correo: llega a la campana pero no al correo', async () => {
    await team.seller.api.put('/api/v1/notifications/preferences', { type: 'task_reminder', inApp: true, email: false, push: true }).expect(200);
    await remindSeller('Solo campana');
    expect(sellerMails('Solo campana')).toHaveLength(0);
    expect((await sellerBell()).items.some((n) => n.title.includes('Solo campana'))).toBe(true);
  });

  it('sin campana: llega al correo pero no aparece ni suma en la campana', async () => {
    await team.seller.api.put('/api/v1/notifications/preferences', { type: 'task_reminder', inApp: false, email: true, push: true }).expect(200);
    const before = (await sellerBell()).unread;
    await remindSeller('Solo correo');
    expect(sellerMails('Solo correo')).toHaveLength(1);
    const bell = await sellerBell();
    expect(bell.items.some((n) => n.title.includes('Solo correo'))).toBe(false);
    expect(bell.unread).toBe(before);
  });

  it('la campana trae el tipo y si es importante, para los filtros', async () => {
    const bell = (await team.seller.api.get('/api/v1/notifications').expect(200)).body as { items: { type: string; important: boolean }[] };
    expect(bell.items[0]).toMatchObject({ type: 'task_reminder', important: false });
  });

  it('las preferencias son de cada persona', async () => {
    const ownerPrefs = (await team.owner.api.get('/api/v1/notifications/preferences').expect(200)).body;
    expect(ownerPrefs.find((p: { type: string }) => p.type === 'task_reminder')).toMatchObject({ inApp: true, email: true });
  });

  it('valida el tipo y no deja apagar el correo de cobros', async () => {
    await team.owner.api.put('/api/v1/notifications/preferences', { type: 'inventado', inApp: true, email: true, push: true }).expect(400);
    expect((await team.owner.api.put('/api/v1/notifications/preferences', { type: 'billing', inApp: false, email: false, push: true }).expect(400)).body.code).toBe('EMAIL_REQUIRED');
    await team.owner.api.put('/api/v1/notifications/preferences', { type: 'billing', inApp: false, email: true, push: true }).expect(200);
  });

  describe('Push en el navegador', () => {
    const subscription = (endpoint: string) => ({ endpoint, keys: { p256dh: 'clave-p256dh', auth: 'clave-auth' } });
    const pushesTo = (endpoint: string, title: string) => t.push.sent.filter((p) => p.endpoint === endpoint && p.payload.title.includes(title));

    it('expone la llave pública VAPID para suscribirse', async () => {
      const config = (await team.seller.api.get('/api/v1/notifications/push/config').expect(200)).body;
      expect(config.publicKey).toMatch(/^B[\w-]{80,}$/);
    });

    it('con un dispositivo suscrito, el aviso llega por push con su enlace', async () => {
      await team.seller.api.put('/api/v1/notifications/preferences', { type: 'task_reminder', inApp: true, email: false, push: true }).expect(200);
      await team.seller.api.post('/api/v1/notifications/push/subscriptions', subscription('https://push.example/vendedor')).expect(204);
      await remindSeller('Por push');
      const [sent] = pushesTo('https://push.example/vendedor', 'Por push');
      expect(sent?.payload).toMatchObject({ link: '/tasks' });
      expect(sent?.payload.title).toContain('Por push');
    });

    it('con push apagado para el tipo, no sale nada al dispositivo', async () => {
      await team.seller.api.put('/api/v1/notifications/preferences', { type: 'task_reminder', inApp: true, email: false, push: false }).expect(200);
      await remindSeller('Sin push');
      expect(pushesTo('https://push.example/vendedor', 'Sin push')).toHaveLength(0);
    });

    it('si el servicio de push dice que la suscripción ya no existe, se borra', async () => {
      await team.seller.api.put('/api/v1/notifications/preferences', { type: 'task_reminder', inApp: true, email: false, push: true }).expect(200);
      await team.seller.api.post('/api/v1/notifications/push/subscriptions', subscription('https://push.example/vencida')).expect(204);
      t.push.gone.add('https://push.example/vencida');
      await remindSeller('Vencida');
      const { rows } = await t.owner.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', ['https://push.example/vencida']);
      expect(rows).toHaveLength(0);
    });

    it('al desactivar en el dispositivo deja de llegar', async () => {
      await team.seller.api.post('/api/v1/notifications/push/unsubscribe', { endpoint: 'https://push.example/vendedor' }).expect(204);
      await remindSeller('Ya no');
      expect(pushesTo('https://push.example/vendedor', 'Ya no')).toHaveLength(0);
    });

    it('valida la suscripción', async () => {
      await team.seller.api.post('/api/v1/notifications/push/subscriptions', { endpoint: 'no-es-url', keys: { p256dh: 'a', auth: 'b' } }).expect(400);
    });
  });
});
