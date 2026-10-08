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

  it('cada tipo arranca con app y correo activos; el correo de cobros no se puede apagar', async () => {
    const prefs = (await team.seller.api.get('/api/v1/notifications/preferences').expect(200)).body;
    expect(prefs.map((p: { type: string }) => p.type)).toEqual(['task_reminder', 'no_reply', 'sla_breach', 'deal_won', 'billing']);
    expect(prefs.every((p: { inApp: boolean; email: boolean }) => p.inApp && p.email)).toBe(true);
    expect(prefs.find((p: { type: string }) => p.type === 'billing')).toMatchObject({ emailLocked: true });
    expect(prefs[0].label).toBeTruthy();
  });

  it('sin correo: llega a la campana pero no al correo', async () => {
    await team.seller.api.put('/api/v1/notifications/preferences', { type: 'task_reminder', inApp: true, email: false }).expect(200);
    await remindSeller('Solo campana');
    expect(sellerMails('Solo campana')).toHaveLength(0);
    expect((await sellerBell()).items.some((n) => n.title.includes('Solo campana'))).toBe(true);
  });

  it('sin campana: llega al correo pero no aparece ni suma en la campana', async () => {
    await team.seller.api.put('/api/v1/notifications/preferences', { type: 'task_reminder', inApp: false, email: true }).expect(200);
    const before = (await sellerBell()).unread;
    await remindSeller('Solo correo');
    expect(sellerMails('Solo correo')).toHaveLength(1);
    const bell = await sellerBell();
    expect(bell.items.some((n) => n.title.includes('Solo correo'))).toBe(false);
    expect(bell.unread).toBe(before);
  });

  it('las preferencias son de cada persona', async () => {
    const ownerPrefs = (await team.owner.api.get('/api/v1/notifications/preferences').expect(200)).body;
    expect(ownerPrefs.find((p: { type: string }) => p.type === 'task_reminder')).toMatchObject({ inApp: true, email: true });
  });

  it('valida el tipo y no deja apagar el correo de cobros', async () => {
    await team.owner.api.put('/api/v1/notifications/preferences', { type: 'inventado', inApp: true, email: true }).expect(400);
    expect((await team.owner.api.put('/api/v1/notifications/preferences', { type: 'billing', inApp: false, email: false }).expect(400)).body.code).toBe('EMAIL_REQUIRED');
    await team.owner.api.put('/api/v1/notifications/preferences', { type: 'billing', inApp: false, email: true }).expect(200);
  });
});
