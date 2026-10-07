import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AutomationService } from '../src/modules/automation/automation.service.js';
import { createTeam, createTestApp, type TestApp } from './support/test-app.js';
import { connectChannel, conversationOf, inboundText, newPhoneId, sendWebhook } from './support/whatsapp.js';

let n = 0;
const phone = () => `5733${String(Date.now()).slice(-6)}${String(n++).padStart(2, '0')}`;

/** E07-S01 reglas, E09-S01 Click-to-WhatsApp, E10-S01 límites del plan. */
describe('Automatización, enlaces y plan', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  let pnid: string;
  let channelId: string;

  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Reglas SAS');
    pnid = newPhoneId();
    channelId = (await connectChannel(team.owner.api, pnid).expect(201)).body.id;
  });
  afterAll(() => t.close());

  describe('Reglas predefinidas (E07-S01)', () => {
    it('lead nuevo → se asigna por turnos entre vendedores y se crea una tarea', async () => {
      await team.admin.api.put('/api/v1/automation/rules/new_lead', { enabled: true, config: { taskDueMinutes: 15 } }).expect(200);
      const from = phone();
      await sendWebhook(t, inboundText(pnid, from, 'Hola, precio del andamio')).expect(200);
      const conv = await conversationOf(team.owner.api, `+${from}`);
      const deal = (await t.owner.query(`SELECT id, owner_id FROM deals WHERE contact_id = $1`, [conv.contact.id])).rows[0];
      expect(deal.owner_id).toBe(team.seller.userId); // único vendedor del equipo
      const tasks = (await t.owner.query(`SELECT title, assignee_id FROM tasks WHERE deal_id = $1`, [deal.id])).rows;
      expect(tasks).toEqual([{ title: expect.stringMatching(/responder/i), assignee_id: team.seller.userId }]);
      const runs = (await team.admin.api.get('/api/v1/automation/runs').expect(200)).body;
      expect(runs[0]).toMatchObject({ rule: 'new_lead', status: 'ok' });
    });

    it('sin respuesta en X horas → notifica al responsable, una sola vez', async () => {
      await team.admin.api.put('/api/v1/automation/rules/no_reply', { enabled: true, config: { hours: 2 } }).expect(200);
      const from = phone();
      await sendWebhook(t, inboundText(pnid, from, '¿Hay alguien?')).expect(200);
      const conv = await conversationOf(team.owner.api, `+${from}`);
      await team.owner.api.patch(`/api/v1/conversations/${conv.id}/assignment`, { userId: team.admin.userId }).expect(200);
      await t.owner.query(`UPDATE conversations SET last_inbound_at = now() - interval '3 hours' WHERE id = $1`, [conv.id]);

      await t.app.get(AutomationService).sweepNoReply();
      await t.app.get(AutomationService).sweepNoReply();
      const notes = (await team.admin.api.get('/api/v1/notifications').expect(200)).body.items;
      expect(notes.filter((x: { type: string; link: string }) => x.type === 'no_reply' && x.link.includes(conv.id))).toHaveLength(1);
    });

    it('cambio de etapa → envía la plantilla configurada al cliente', async () => {
      const pipeline = (await team.owner.api.get('/api/v1/pipelines').expect(200)).body[0];
      const tpl = (await team.owner.api.post('/api/v1/whatsapp/templates', { channelId, name: 'propuesta_lista', language: 'es_CO', category: 'UTILITY', body: 'Tu propuesta está lista', examples: [] }).expect(201)).body;
      await t.owner.query(`UPDATE whatsapp_templates SET status = 'APPROVED' WHERE id = $1`, [tpl.id]);
      await team.admin.api.put('/api/v1/automation/rules/stage_template', { enabled: true, config: { stages: { [pipeline.stages[2].id]: tpl.id } } }).expect(200);

      const from = phone();
      await sendWebhook(t, inboundText(pnid, from, 'Hola')).expect(200);
      const conv = await conversationOf(team.owner.api, `+${from}`);
      const deal = (await t.owner.query(`SELECT id FROM deals WHERE contact_id = $1`, [conv.contact.id])).rows[0];
      await team.owner.api.post(`/api/v1/deals/${deal.id}/move`, { stageId: pipeline.stages[2].id }).expect(200);
      expect(t.whatsapp.sent.at(-1)).toMatchObject({ to: `+${from}`, payload: { type: 'template', name: 'propuesta_lista' } });
    });

    it('ganado → notifica a propietario, admins y responsable', async () => {
      await team.admin.api.put('/api/v1/automation/rules/won_notify', { enabled: true, config: {} }).expect(200);
      const pipeline = (await team.owner.api.get('/api/v1/pipelines').expect(200)).body[0];
      const won = (await team.owner.api.get('/api/v1/close-reasons').expect(200)).body.find((r: { outcome: string }) => r.outcome === 'won');
      const deal = (await team.owner.api.post('/api/v1/deals', { title: 'Venta grande', pipelineId: pipeline.id, ownerId: team.seller.userId, value: 9000000 }).expect(201)).body;
      await team.owner.api.post(`/api/v1/deals/${deal.id}/close`, { outcome: 'won', reasonId: won.id }).expect(200);
      for (const member of [team.owner, team.admin, team.seller]) {
        const items = (await member.api.get('/api/v1/notifications').expect(200)).body.items;
        expect(items.some((x: { type: string; title: string }) => x.type === 'deal_won' && x.title.includes('Venta grande'))).toBe(true);
      }
    });

    it('una regla apagada no se ejecuta; el vendedor no configura reglas', async () => {
      await team.admin.api.put('/api/v1/automation/rules/new_lead', { enabled: false, config: {} }).expect(200);
      const from = phone();
      await sendWebhook(t, inboundText(pnid, from, 'Hola')).expect(200);
      const conv = await conversationOf(team.owner.api, `+${from}`);
      expect((await t.owner.query(`SELECT owner_id FROM deals WHERE contact_id = $1`, [conv.contact.id])).rows[0].owner_id).toBeNull();
      await team.seller.api.put('/api/v1/automation/rules/new_lead', { enabled: true, config: {} }).expect(403);
    });
  });

  describe('Click-to-WhatsApp con UTM (E09-S01)', () => {
    it('el enlace redirige a WhatsApp, cuenta clics y atribuye origen y campaña al contacto', async () => {
      const link = (await team.admin.api.post('/api/v1/wa-links', { channelId, message: 'Hola, quiero cotizar', utmSource: 'facebook', utmMedium: 'cpc', utmCampaign: 'andamios-octubre' }).expect(201)).body;
      expect(link.url).toMatch(/\/l\/[a-z0-9]{8}$/);

      const click = await t.http().get(new URL(link.url).pathname).redirects(0).expect(302);
      expect(click.headers.location).toMatch(/^https:\/\/wa\.me\/\d+\?text=Hola%2C%20quiero%20cotizar%20\(ref%3A%20[a-z0-9]{8}\)$/);
      expect((await team.admin.api.get('/api/v1/wa-links').expect(200)).body[0].clicks).toBe(1);

      const from = phone();
      await sendWebhook(t, inboundText(pnid, from, `Hola, quiero cotizar (ref: ${link.code})`)).expect(200);
      const conv = await conversationOf(team.owner.api, `+${from}`);
      const contact = (await team.owner.api.get(`/api/v1/contacts/${conv.contact.id}`).expect(200)).body;
      expect(contact).toMatchObject({ source: 'facebook', campaign: 'andamios-octubre' });
    });

    it('un código inexistente no redirige a ningún lado', async () => {
      await t.http().get('/l/noexiste').redirects(0).expect(404);
    });
  });

  describe('Límites del plan (E10-S01)', () => {
    it('trial: un solo número de WhatsApp', async () => {
      const res = await connectChannel(team.owner.api, newPhoneId()).expect(409);
      expect(res.body.code).toBe('PLAN_CHANNEL_LIMIT_REACHED');
    });

    it('trial: el almacenamiento lleno bloquea importaciones', async () => {
      const tenantId = (await t.owner.query(`SELECT tenant_id FROM whatsapp_channels WHERE id = $1`, [channelId])).rows[0].tenant_id;
      await t.owner.query(`INSERT INTO tenant_usage (tenant_id, storage_bytes) VALUES ($1, $2) ON CONFLICT (tenant_id) DO UPDATE SET storage_bytes = $2`, [tenantId, 1024 ** 3]);
      const res = await team.owner.agent.post('/api/v1/imports').set('Origin', 'http://localhost:5173').attach('file', Buffer.from('Nombre\nA'), 'a.csv').expect(409);
      expect(res.body.code).toBe('PLAN_STORAGE_LIMIT_REACHED');
      await t.owner.query(`UPDATE tenant_usage SET storage_bytes = 0 WHERE tenant_id = $1`, [tenantId]);
    });

    it('el uso del plan es visible', async () => {
      const usage = (await team.owner.api.get('/api/v1/plan').expect(200)).body;
      expect(usage).toMatchObject({ plan: 'trial', limits: { maxUsers: 3, maxChannels: 1 }, usage: { users: 3, channels: 1, storageBytes: expect.any(Number) } });
    });
  });
});
