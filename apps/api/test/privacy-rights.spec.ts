import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTeam, createTestApp, type TestApp } from './support/test-app.js';

/** E13-S03 — Derechos del titular (Ley 1581): consulta, actualización, supresión y exportación. */
describe('Derechos del titular (E13-S03)', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  let pipelineId: string;

  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Titulares SAS');
    pipelineId = (await team.owner.api.get('/api/v1/pipelines').expect(200)).body[0].id;
  });
  afterAll(() => t.close());

  async function titular(name: string) {
    const contact = (await team.owner.api.post('/api/v1/contacts', { name, phone: '3001234567', email: `${name.split(' ')[0]!.toLowerCase()}@correo.co`, notes: 'Cliente frecuente', allowDuplicate: true }).expect(201)).body;
    const deal = (await team.owner.api.post('/api/v1/deals', { title: `${name} (WhatsApp)`, pipelineId, contactId: contact.id, value: 500000, description: `Habló con ${name}` }).expect(201)).body;
    await team.owner.api.post('/api/v1/tasks', { title: `Llamar a ${name}`, contactId: contact.id }).expect(201);
    await team.owner.api.post(`/api/v1/contacts/${contact.id}/consents`, { legalBasis: 'consent', purposes: ['sales'], granted: true, channel: 'phone' }).expect(201);
    return { contact, deal };
  }

  describe('Solicitudes con plazo legal', () => {
    it('una consulta vence en 10 días hábiles y un reclamo en 15; se listan y se resuelven', async () => {
      const { contact } = await titular('Ana Consulta');
      const access = (await team.admin.api.post('/api/v1/privacy/requests', { contactId: contact.id, type: 'access', channel: 'email', details: 'Pide saber qué datos tenemos' }).expect(201)).body;
      const erase = (await team.owner.api.post('/api/v1/privacy/requests', { contactId: contact.id, type: 'erase', channel: 'whatsapp' }).expect(201)).body;
      expect(access.status).toBe('open');
      const days = (iso: string) => (Date.parse(iso) - Date.now()) / 86_400_000;
      expect(days(access.dueAt)).toBeGreaterThanOrEqual(13); // 10 hábiles ≥ 14 calendario menos el día en curso
      expect(days(erase.dueAt)).toBeGreaterThan(days(access.dueAt));

      const open = (await team.owner.api.get('/api/v1/privacy/requests?status=open').expect(200)).body;
      expect(open.map((r: { id: string }) => r.id)).toEqual(expect.arrayContaining([access.id, erase.id]));
      expect(open.find((r: { id: string }) => r.id === access.id).contactName).toBe('Ana Consulta');

      const done = (await team.owner.api.post(`/api/v1/privacy/requests/${access.id}/resolve`, { status: 'resolved', resolution: 'Se envió la exportación por correo' }).expect(200)).body;
      expect(done).toMatchObject({ status: 'resolved', resolvedBy: team.owner.userId });
      await team.owner.api.post(`/api/v1/privacy/requests/${access.id}/resolve`, { status: 'resolved', resolution: 'otra vez' }).expect(409);
    });

    it('el vendedor no gestiona solicitudes de titulares', async () => {
      await team.seller.api.get('/api/v1/privacy/requests').expect(403);
    });
  });

  describe('Consulta y exportación', () => {
    it('entrega en JSON todo lo que hay del titular y queda en auditoría', async () => {
      const { contact, deal } = await titular('Beto Exporta');
      const res = await team.admin.agent.get(`/api/v1/contacts/${contact.id}/personal-data`).expect(200);
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="datos-personales-/);
      const data = JSON.parse(res.text);
      expect(data.contact).toMatchObject({ name: 'Beto Exporta', email: 'beto@correo.co', notes: 'Cliente frecuente' });
      expect(data.deals[0]).toMatchObject({ id: deal.id, title: 'Beto Exporta (WhatsApp)' });
      expect(data.tasks[0].title).toBe('Llamar a Beto Exporta');
      expect(data.consents[0]).toMatchObject({ legalBasis: 'consent', purposes: ['sales'] });
      expect(data).toHaveProperty('conversations');
      expect(data.generatedAt).toBeTruthy();
      const { rows } = await t.owner.query(`SELECT 1 FROM audit_log WHERE action = 'export' AND entity = 'personal_data' AND entity_id = $1`, [contact.id]);
      expect(rows).toHaveLength(1);
    });
  });

  describe('Supresión', () => {
    it('anonimiza al titular, borra tareas y conversaciones; conserva negocios sin datos personales y la prueba de consentimiento', async () => {
      const { contact, deal } = await titular('Carla Borrar');
      await team.owner.api.post(`/api/v1/contacts/${contact.id}/erase`, {}).expect(400);
      const res = (await team.owner.api.post(`/api/v1/contacts/${contact.id}/erase`, { confirm: true }).expect(200)).body;
      expect(res).toMatchObject({ erased: true });

      const after = (await team.owner.api.get(`/api/v1/contacts/${contact.id}`).expect(200)).body;
      expect(after).toMatchObject({ name: 'Titular suprimido', phone: null, email: null, notes: null, tags: [], customFields: {} });
      const keptDeal = (await team.owner.api.get(`/api/v1/deals/${deal.id}`).expect(200)).body;
      expect(keptDeal.title).toBe('Titular suprimido (WhatsApp)');
      expect(keptDeal.description).toBeNull();
      expect(Number(keptDeal.value)).toBe(500000);
      expect((await team.owner.api.get(`/api/v1/tasks?contactId=${contact.id}&status=all`).expect(200)).body).toEqual([]);
      expect((await team.owner.api.get(`/api/v1/contacts/${contact.id}/consents`).expect(200)).body.history).toHaveLength(1);
      expect((await team.owner.api.get('/api/v1/search?q=Carla').expect(200)).body.contacts ?? []).toEqual([]);
    });

    it('cierra la solicitud de supresión vinculada', async () => {
      const { contact } = await titular('Dario Solicitud');
      const req = (await team.owner.api.post('/api/v1/privacy/requests', { contactId: contact.id, type: 'erase', channel: 'email' }).expect(201)).body;
      await team.owner.api.post(`/api/v1/contacts/${contact.id}/erase`, { confirm: true, requestId: req.id }).expect(200);
      const list = (await team.owner.api.get('/api/v1/privacy/requests?status=resolved').expect(200)).body;
      expect(list.find((r: { id: string }) => r.id === req.id)).toMatchObject({ status: 'resolved', resolution: expect.stringMatching(/suprim/i) });
    });

    it('funciona aunque la cuenta esté en solo lectura (es una obligación legal); el vendedor no puede', async () => {
      const { contact } = await titular('Elena Lectura');
      await team.seller.api.post(`/api/v1/contacts/${contact.id}/erase`, { confirm: true }).expect(403);
      await t.owner.query(`UPDATE subscriptions s SET status = 'read_only' FROM member m JOIN "user" u ON u.id = m."userId"
        WHERE m."organizationId" = s.tenant_id AND u.email = $1`, [team.owner.email]);
      try {
        await team.owner.api.post('/api/v1/contacts', { name: 'Bloqueado' }).expect(402);
        await team.owner.api.post(`/api/v1/contacts/${contact.id}/erase`, { confirm: true }).expect(200);
      } finally {
        await t.owner.query(`UPDATE subscriptions s SET status = 'trialing' FROM member m JOIN "user" u ON u.id = m."userId"
          WHERE m."organizationId" = s.tenant_id AND u.email = $1`, [team.owner.email]);
      }
    });

    it('otra empresa no exporta ni suprime titulares ajenos', async () => {
      const { contact } = await titular('Fabio Ajeno');
      const other = (await createTeam(t, 'Otra de titulares')).owner;
      await other.agent.get(`/api/v1/contacts/${contact.id}/personal-data`).expect(404);
      await other.api.post(`/api/v1/contacts/${contact.id}/erase`, { confirm: true }).expect(404);
    });
  });
});
