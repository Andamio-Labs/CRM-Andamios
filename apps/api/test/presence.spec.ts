import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TasksService } from '../src/modules/tasks/tasks.service.js';
import { createTeam, createTestApp, type TestApp } from './support/test-app.js';
import { connectChannel, conversationOf, inboundText, newPhoneId, sendWebhook } from './support/whatsapp.js';

let n = 0;
const phone = () => `5734${String(Date.now()).slice(-6)}${String(n++).padStart(2, '0')}`;

interface Presence { userId: string; status: string; until: string | null }

/** E01-S09 — Estado del empleado y asignación consciente. */
describe('Estado del empleado (E01-S09)', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  const statusOf = async (userId: string) =>
    ((await team.owner.api.get('/api/v1/presence').expect(200)).body as Presence[]).find((p) => p.userId === userId)!;

  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Estados SAS');
  });
  afterAll(() => t.close());

  it('cada persona arranca en línea y elige su estado, con duración', async () => {
    expect(await statusOf(team.seller.userId)).toMatchObject({ status: 'online', until: null, name: 'Nuevo member' });
    // Es también el directorio del equipo: el vendedor lo ve aunque no gestione miembros.
    expect((await team.seller.api.get('/api/v1/presence').expect(200)).body).toHaveLength(3);

    const visit = (await team.seller.api.put('/api/v1/presence', { status: 'visit', duration: '1h' }).expect(200)).body;
    expect(visit.status).toBe('visit');
    expect(Date.parse(visit.until) - Date.now()).toBeGreaterThan(59 * 60_000);
    expect(await statusOf(team.seller.userId)).toMatchObject({ status: 'visit' });

    const dnd = (await team.seller.api.put('/api/v1/presence', { status: 'dnd', duration: 'end_of_day' }).expect(200)).body;
    expect(Date.parse(dnd.until)).toBeGreaterThan(Date.now());
    expect(Date.parse(dnd.until) - Date.now()).toBeLessThanOrEqual(24 * 3_600_000);

    expect((await team.seller.api.put('/api/v1/presence', { status: 'online', duration: '1h' }).expect(200)).body).toMatchObject({ status: 'online', until: null });
    await team.seller.api.put('/api/v1/presence', { status: 'ausente' }).expect(400);
  });

  it('al vencer el tiempo vuelve a en línea', async () => {
    await team.seller.api.put('/api/v1/presence', { status: 'dnd', duration: '1h' }).expect(200);
    await t.owner.query(`UPDATE member_presence SET until = now() - interval '1 minute' WHERE user_id = $1`, [team.seller.userId]);
    expect(await statusOf(team.seller.userId)).toMatchObject({ status: 'online', until: null });
  });

  it('con no molestar, los avisos esperan en la campana y no salen por correo', async () => {
    const contactId = (await team.owner.api.post('/api/v1/contacts', { name: 'Cliente de estados' }).expect(201)).body.id;
    const remindSeller = async (title: string) => {
      await team.owner.api.post('/api/v1/tasks', { title, contactId, assigneeId: team.seller.userId, dueAt: new Date(Date.now() + 5 * 60_000).toISOString(), remindBeforeMinutes: 10 }).expect(201);
      await t.app.get(TasksService).sendDueReminders();
    };
    const mails = (title: string) => t.mailer.sent.filter((m) => m.to === team.seller.email && m.subject.includes(title));

    await team.seller.api.put('/api/v1/presence', { status: 'dnd' }).expect(200);
    await remindSeller('Llamar en silencio');
    expect(mails('Llamar en silencio')).toHaveLength(0);
    const bell = (await team.seller.api.get('/api/v1/notifications').expect(200)).body.items;
    expect(bell.some((x: { title: string }) => x.title.includes('Llamar en silencio'))).toBe(true);

    await team.seller.api.put('/api/v1/presence', { status: 'online' }).expect(200);
    await remindSeller('Llamar con aviso');
    expect(mails('Llamar con aviso')).toHaveLength(1);
  });

  it('la asignación automática omite a quien está en no molestar', async () => {
    const pnid = newPhoneId();
    await connectChannel(team.owner.api, pnid).expect(201);
    await team.admin.api.put('/api/v1/automation/rules/new_lead', { enabled: true, config: {} }).expect(200);
    const ownerOfNewLead = async () => {
      const from = phone();
      await sendWebhook(t, inboundText(pnid, from, 'Hola, ¿tienen andamios?')).expect(200);
      const conv = await conversationOf(team.owner.api, `+${from}`);
      return (await t.owner.query(`SELECT owner_id FROM deals WHERE contact_id = $1`, [conv.contact.id])).rows[0].owner_id;
    };

    await team.seller.api.put('/api/v1/presence', { status: 'dnd' }).expect(200);
    expect(await ownerOfNewLead()).toBeNull();
    const runs = (await team.admin.api.get('/api/v1/automation/runs').expect(200)).body;
    expect(runs[0]).toMatchObject({ rule: 'new_lead', status: 'skipped', detail: expect.stringMatching(/disponible/) });

    await team.seller.api.put('/api/v1/presence', { status: 'visit' }).expect(200);
    expect(await ownerOfNewLead()).toBe(team.seller.userId);
  });

  it('el estado de una empresa no se ve desde otra', async () => {
    const other = await createTeam(t, 'Otra de estados');
    const ids = ((await other.owner.api.get('/api/v1/presence').expect(200)).body as Presence[]).map((p) => p.userId);
    expect(ids).not.toContain(team.seller.userId);
    expect(ids).toContain(other.seller.userId);
  });

  // Al final: cierra la sesión del admin.
  it('quien cerró sesión se ve desconectado', async () => {
    await team.admin.api.post('/api/auth/sign-out', {}).expect(200);
    expect(await statusOf(team.admin.userId)).toMatchObject({ status: 'offline', until: null });
  });
});
