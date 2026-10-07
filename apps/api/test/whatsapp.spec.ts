import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MetaApiError } from '../src/modules/whatsapp/infrastructure/whatsapp-api.js';
import { JOB_HANDLERS } from '../src/shared/queue/queue.module.js';
import { as, createTeam, createTestApp, registerAndLogin, type TestApp } from './support/test-app.js';
import { connectChannel, conversationOf as findConversation, inboundText, newPhoneId, sendWebhook, statusUpdate } from './support/whatsapp.js';

/** Sprint 3 — E04-S01..S04 + E15-S06 con el adaptador local de Meta. */
describe('WhatsApp', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  let phoneNumberId: string;

  const connect = (api: ReturnType<typeof as>, id = newPhoneId(), code = 'codigo-ok') => connectChannel(api, id, code);
  const webhook = (payload: object, secret?: string) => sendWebhook(t, payload, secret);
  const inbound = (pnid: string, from: string, id: string, text: string) => inboundText(pnid, from, text, { id });

  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Óptica Central');
    phoneNumberId = newPhoneId();
    await connect(team.owner.api, phoneNumberId).expect(201);
  });
  afterAll(() => t.close());

  describe('Conexión del número (E04-S01)', () => {
    it('el propietario conecta: queda verificado, con calidad visible y el token cifrado', async () => {
      const { api } = (await createTeam(t, 'Conecta')).owner;
      const id = newPhoneId();
      const res = await connect(api, id, 'abc').expect(201);
      expect(res.body).toMatchObject({ phoneNumberId: id, status: 'connected', verifiedName: `Número local ${id}`, nameStatus: 'APPROVED', qualityRating: 'GREEN' });
      expect(res.body).not.toHaveProperty('token');

      const { rows } = await t.owner.query(`SELECT ciphertext FROM tenant_secrets WHERE name = $1`, [`whatsapp.token:${id}`]);
      expect(rows).toHaveLength(1);
      expect(rows[0].ciphertext).not.toContain('local-token-abc');
      expect((await api.get('/api/v1/whatsapp/channels').expect(200)).body.map((c: { phoneNumberId: string }) => c.phoneNumberId)).toEqual([id]);
    });

    it('solo el propietario conecta', async () => {
      await connect(team.admin.api).expect(403);
    });

    it('un código inválido devuelve un error entendible', async () => {
      // Empresa sin números: el límite del plan (1 en trial) no debe tapar el error de Meta.
      const res = await connect((await createTeam(t, 'Código inválido')).owner.api, newPhoneId(), 'invalid').expect(400);
      expect(res.body.code).toBe('WHATSAPP_CONNECT_FAILED');
    });

    it('un número no puede estar en dos empresas', async () => {
      const other = as((await registerAndLogin(t)).agent);
      const res = await connect(other, phoneNumberId).expect(409);
      expect(res.body.code).toBe('PHONE_ALREADY_CONNECTED');
    });
  });

  describe('Webhook de entrada (E04-S02)', () => {
    it('verificación de Meta: devuelve el challenge solo con el token correcto', async () => {
      const ok = await t.http().get('/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=4242').expect(200);
      expect(ok.text).toBe('4242');
      await t.http().get('/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=1').expect(403);
    });

    it('rechaza firmas inválidas sin tocar datos', async () => {
      await webhook(inbound(phoneNumberId, '573110000001', 'wamid.fake', 'x'), 'secreto-falso').expect(401);
      expect((await t.owner.query(`SELECT 1 FROM messages WHERE wa_message_id = 'wamid.fake'`)).rowCount).toBe(0);
    });

    it('crea contacto, negocio, conversación y mensaje; es idempotente ante reintentos de Meta', async () => {
      const body = inbound(phoneNumberId, '573112223344', `wamid.${randomUUID()}`, 'Hola, ¿precio de las gafas?');
      await webhook(body).expect(200);
      await webhook(body).expect(200); // Meta reintenta

      const conv = await findConversation(team.owner.api, '+573112223344');
      expect(conv).toMatchObject({ unreadCount: 1, contact: { name: 'Carlos Ruiz' } });
      const messages = (await team.owner.api.get(`/api/v1/conversations/${conv.id}/messages`).expect(200)).body;
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ direction: 'in', body: 'Hola, ¿precio de las gafas?', status: 'received' });

      const deals = await t.owner.query(`SELECT source FROM deals WHERE contact_id = $1`, [conv.contact.id]);
      expect(deals.rows).toEqual([{ source: 'whatsapp' }]);

      // Segundo mensaje del mismo cliente: no se crea otro negocio.
      await webhook(inbound(phoneNumberId, '573112223344', `wamid.${randomUUID()}`, '¿Siguen ahí?')).expect(200);
      expect((await t.owner.query(`SELECT 1 FROM deals WHERE contact_id = $1`, [conv.contact.id])).rowCount).toBe(1);
    });

    it('un número desconocido responde 200 (Meta no debe reintentar) y no guarda nada', async () => {
      await webhook(inbound('PN-NO-EXISTE', '573000000009', 'wamid.huerfano', 'x')).expect(200);
      expect((await t.owner.query(`SELECT 1 FROM messages WHERE wa_message_id = 'wamid.huerfano'`)).rowCount).toBe(0);
    });

    it('el mensaje queda visible en menos de 3 s (p95)', async () => {
      const timings: number[] = [];
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        await webhook(inbound(phoneNumberId, `5731500000${String(i).padStart(2, '0')}`, `wamid.${randomUUID()}`, `msg ${i}`)).expect(200);
        timings.push(performance.now() - start);
      }
      timings.sort((a, b) => a - b);
      expect(timings[18]!).toBeLessThan(3000);
    });
  });

  describe('Envío y ventana de 24 h (E04-S03, E04-S04)', () => {
    async function freshConversation(phone: string) {
      await webhook(inbound(phoneNumberId, phone, `wamid.${randomUUID()}`, 'Hola')).expect(200);
      return findConversation(team.owner.api, `+${phone}`);
    }

    it('envía texto dentro de la ventana y pasa a enviado con el id de Meta', async () => {
      const conv = await freshConversation('573120000001');
      expect(conv.window.open).toBe(true);
      expect(new Date(conv.window.closesAt).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);

      const sent = await team.seller.api.post(`/api/v1/conversations/${conv.id}/messages`, { type: 'text', text: 'Con gusto, te cuento' }).expect(202);
      const messages = (await team.owner.api.get(`/api/v1/conversations/${conv.id}/messages`).expect(200)).body;
      const out = messages.find((m: { id: string }) => m.id === sent.body.id);
      expect(out).toMatchObject({ direction: 'out', status: 'sent', body: 'Con gusto, te cuento' });
      expect(out.waMessageId).toMatch(/^wamid\.local\./);
      expect(t.whatsapp.sent.at(-1)).toMatchObject({ phoneNumberId, to: '+573120000001' });
    });

    it('los estados de Meta avanzan y nunca retroceden (delivered tardío no pisa read)', async () => {
      const conv = await freshConversation('573120000002');
      const { body } = await team.owner.api.post(`/api/v1/conversations/${conv.id}/messages`, { type: 'text', text: 'Hola' }).expect(202);
      const waId = (await t.owner.query(`SELECT wa_message_id FROM messages WHERE id = $1`, [body.id])).rows[0].wa_message_id;
      await webhook(statusUpdate(phoneNumberId, waId, 'read')).expect(200);
      await webhook(statusUpdate(phoneNumberId, waId, 'delivered')).expect(200);
      expect((await t.owner.query(`SELECT status FROM messages WHERE id = $1`, [body.id])).rows[0].status).toBe('read');
    });

    it('fuera de la ventana solo se permiten plantillas', async () => {
      const conv = await freshConversation('573120000003');
      await t.owner.query(`UPDATE conversations SET last_inbound_at = now() - interval '25 hours' WHERE id = $1`, [conv.id]);
      const res = await team.owner.api.post(`/api/v1/conversations/${conv.id}/messages`, { type: 'text', text: 'hola' }).expect(409);
      expect(res.body.code).toBe('WINDOW_CLOSED');
      const template = (await team.owner.api.post('/api/v1/whatsapp/templates', { channelId: conv.channelId, name: 'seguimiento', language: 'es_CO', category: 'UTILITY', body: 'Hola, ¿seguimos?', examples: [] }).expect(201)).body;
      await t.owner.query(`UPDATE whatsapp_templates SET status = 'APPROVED' WHERE id = $1`, [template.id]);
      await team.owner.api.post(`/api/v1/conversations/${conv.id}/messages`, { type: 'template', templateId: template.id, variables: [] }).expect(202);
      expect((await team.owner.api.get(`/api/v1/conversations/${conv.id}`).expect(200)).body.window.open).toBe(false);
    });

    it('un error de Meta queda traducido en el mensaje', async () => {
      const conv = await freshConversation('573120000004');
      t.whatsapp.failNext(new MetaApiError(400, { code: 131026, message: 'Message undeliverable' }));
      const { body } = await team.owner.api.post(`/api/v1/conversations/${conv.id}/messages`, { type: 'text', text: 'x' }).expect(202);
      const msg = (await t.owner.query(`SELECT status, error FROM messages WHERE id = $1`, [body.id])).rows[0];
      expect(msg.status).toBe('failed');
      expect(msg.error).toMatchObject({ code: 131026, message: expect.stringMatching(/no se pudo entregar/i) });
    });

    it('token vencido: el mensaje falla y el canal queda desconectado para reconectar', async () => {
      const owner = (await createTeam(t, 'Token vencido')).owner;
      const id = newPhoneId();
      await connect(owner.api, id).expect(201);
      await webhook(inbound(id, '573130000001', `wamid.${randomUUID()}`, 'hola')).expect(200);
      const conv = await findConversation(owner.api, '+573130000001');
      t.whatsapp.failNext(new MetaApiError(401, { code: 190, message: 'Session has expired' }));
      await owner.api.post(`/api/v1/conversations/${conv.id}/messages`, { type: 'text', text: 'x' }).expect(202);
      expect((await owner.api.get('/api/v1/whatsapp/channels').expect(200)).body[0].status).toBe('disconnected');
    });
  });

  describe('Ritmo y cuotas de Meta (E15-S06)', () => {
    it('un 429 de Meta en un intento intermedio se reintenta (el mensaje sigue pendiente)', async () => {
      await webhook(inbound(phoneNumberId, '573140000001', `wamid.${randomUUID()}`, 'hola')).expect(200);
      const conv = await findConversation(team.owner.api, '+573140000001');
      const tenantId = (await t.owner.query(`SELECT tenant_id FROM conversations WHERE id = $1`, [conv.id])).rows[0].tenant_id;
      const { rows } = await t.owner.query(
        `INSERT INTO messages (tenant_id, conversation_id, direction, type, body, status) VALUES ($1, $2, 'out', 'text', 'reintento', 'pending') RETURNING id`,
        [tenantId, conv.id],
      );
      const handlers = t.app.get(JOB_HANDLERS) as Record<string, (data: unknown, job: unknown) => Promise<void>>;
      t.whatsapp.failNext(new MetaApiError(429, { code: 130429, message: 'Rate limit hit' }));

      await expect(handlers['wa.send']!({ tenantId, messageId: rows[0].id }, { attemptsMade: 0, opts: { attempts: 5 } })).rejects.toThrow();
      expect((await t.owner.query(`SELECT status FROM messages WHERE id = $1`, [rows[0].id])).rows[0].status).toBe('pending');

      await handlers['wa.send']!({ tenantId, messageId: rows[0].id }, { attemptsMade: 1, opts: { attempts: 5 } });
      expect((await t.owner.query(`SELECT status FROM messages WHERE id = $1`, [rows[0].id])).rows[0].status).toBe('sent');
    });
  });
});
