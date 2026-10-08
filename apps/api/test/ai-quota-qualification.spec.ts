import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LocalLlm } from '../src/shared/ai/llm.js';
import { LLM_PROVIDER } from '../src/shared/tokens.js';
import { createTeam, createTestApp, type TestApp } from './support/test-app.js';
import { connectChannel, conversationOf, inboundText, newPhoneId, sendWebhook } from './support/whatsapp.js';

/** E05-S04 calificación del lead, E05-S06 cuotas, E05-S08 registro de conversaciones de IA. */
describe('Agente de IA: calificación, cuota y registro', () => {
  let t: TestApp;
  let llm: LocalLlm;
  let team: Awaited<ReturnType<typeof createTeam>>;
  let tenantId: string;
  let pnid: string;
  let seq = 0;
  const newCustomer = () => `5733000${String(++seq).padStart(5, '0')}`;
  const say = (from: string, text: string) => sendWebhook(t, inboundText(pnid, from, text)).expect(200);

  beforeAll(async () => {
    t = await createTestApp({ LLM_API: 'local', LLM_PRICE_INPUT_PER_MTOK: '0.59', LLM_PRICE_OUTPUT_PER_MTOK: '0.79' });
    llm = t.app.get(LLM_PROVIDER) as LocalLlm;
    team = await createTeam(t, 'Califica SAS');
    tenantId = (await t.owner.query(`SELECT id FROM organization WHERE name = 'Califica SAS'`)).rows[0].id;
    pnid = newPhoneId();
    await connectChannel(team.owner.api, pnid).expect(201);
    await team.owner.api.post('/api/v1/custom-fields', { entity: 'deal', key: 'altura', label: 'Altura (m)', type: 'number' }).expect(201);
    await team.owner.api.put('/api/v1/ai/agent', { enabled: true, instructions: 'Alquiler de andamios: $1.200.000 al mes.' }).expect(200);
  });
  afterAll(() => t.close());
  beforeEach(() => llm.reset());

  describe('Calificación del lead (E05-S04)', () => {
    it('ofrece como destino los campos fijos y los personalizados; valida lo que se configura', async () => {
      const agent = (await team.owner.api.get('/api/v1/ai/agent').expect(200)).body;
      expect(agent.qualification).toEqual(['contact.name', 'contact.email', 'deal.description', 'deal.value']);
      expect(agent.qualificationOptions.map((o: { target: string }) => o.target)).toContain('deal.custom.altura');
      expect((await team.owner.api.put('/api/v1/ai/agent', { qualification: ['deal.custom.inventado'] }).expect(400)).body.code).toBe('INVALID_QUALIFICATION');
      await team.owner.api.put('/api/v1/ai/agent', { qualification: ['contact.name', 'contact.email', 'deal.description', 'deal.value', 'deal.custom.altura'] }).expect(200);
    });

    it('le pide al modelo los datos configurados y guarda lo que el cliente dijo en el contacto y el negocio', async () => {
      const phone = newCustomer();
      llm.respondWith(JSON.stringify({
        reply: 'Perfecto Ana, ¿para qué fecha lo necesitas?', handoff: false,
        fields: { 'contact.name': 'Ana Gómez', 'contact.email': 'ana@obra.co', 'deal.value': 3500000, 'deal.description': 'Andamio para fachada de 4 pisos', 'deal.custom.altura': 12 },
      }));
      await sendWebhook(t, inboundText(pnid, phone, 'Soy Ana, ana@obra.co, necesito andamio para fachada de 12 m, presupuesto 3,5 millones', { name: phone })).expect(200);
      expect(llm.calls[0]!.system).toContain('deal.custom.altura: Negocio: Altura (m)');

      const conversation = await conversationOf(team.owner.api, `+${phone}`);
      const { rows: [contact] } = await t.owner.query(`SELECT c.id, c.name, c.email FROM contacts c JOIN conversations v ON v.contact_id = c.id WHERE v.id = $1`, [conversation.id]);
      expect(contact).toMatchObject({ name: 'Ana Gómez', email: 'ana@obra.co' });
      const { rows: [deal] } = await t.owner.query(`SELECT value::float8 AS value, description, custom_fields FROM deals WHERE contact_id = $1 AND status = 'open'`, [contact.id]);
      expect(deal).toEqual({ value: 3500000, description: 'Andamio para fachada de 4 pisos', custom_fields: { altura: 12 } });

      const log = (await team.owner.api.get('/api/v1/ai/interactions').expect(200)).body.items[0];
      const detail = (await team.owner.api.get(`/api/v1/ai/interactions/${log.id}`).expect(200)).body;
      expect(Object.keys(detail.captured)).toHaveLength(5);
    });

    it('no pisa lo que ya cargó una persona', async () => {
      const phone = newCustomer();
      await say(phone, 'Hola');
      const conversation = await conversationOf(team.owner.api, `+${phone}`);
      const { rows: [contact] } = await t.owner.query(`SELECT c.id FROM contacts c JOIN conversations v ON v.contact_id = c.id WHERE v.id = $1`, [conversation.id]);
      await team.owner.api.patch(`/api/v1/contacts/${contact.id}`, { name: 'Ana (cliente de siempre)', email: 'ana@empresa.co' }).expect(200);
      await team.owner.api.put(`/api/v1/conversations/${conversation.id}/ai`, { paused: false }).expect(200);

      llm.respondWith(JSON.stringify({ reply: 'Anotado.', fields: { 'contact.name': 'Ana', 'contact.email': 'otra@x.co' } }));
      await say(phone, 'Me llamo Ana, mi correo es otra@x.co');
      const { rows: [after] } = await t.owner.query(`SELECT name, email FROM contacts WHERE id = $1`, [contact.id]);
      expect(after).toEqual({ name: 'Ana (cliente de siempre)', email: 'ana@empresa.co' });
    });
  });

  describe('Cuota mensual (E05-S06)', () => {
    const fillUsage = async (count: number) => {
      await t.owner.query(`DELETE FROM ai_interactions WHERE tenant_id = $1`, [tenantId]);
      await t.owner.query(`DELETE FROM ai_usage_alerts WHERE tenant_id = $1`, [tenantId]);
      await t.owner.query(
        `INSERT INTO ai_interactions (tenant_id, channel, outcome, prompt) SELECT $1, 'whatsapp', 'replied', '{}'::jsonb FROM generate_series(1, $2)`,
        [tenantId, count],
      );
    };
    const quotaBell = async () => (await team.owner.api.get('/api/v1/notifications').expect(200)).body.items.filter((n: { title: string }) => /cuota/.test(n.title));

    it('muestra el contador del mes contra el límite del plan', async () => {
      await fillUsage(37);
      expect((await team.owner.api.get('/api/v1/ai/usage').expect(200)).body).toMatchObject({ used: 37, limit: 100, percent: 37, exhausted: false, blockOnQuota: true });
      await team.seller.api.get('/api/v1/ai/usage').expect(403);
    });

    it('avisa una sola vez al llegar al 80 %', async () => {
      await fillUsage(79);
      llm.respondWith('{"reply":"Hola"}', '{"reply":"Hola de nuevo"}');
      await say(newCustomer(), 'Hola');
      await say(newCustomer(), 'Hola');
      const alerts = (await quotaBell()).filter((n: { title: string }) => /80 %/.test(n.title));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].link).toBe('/settings?tab=ia');
    });

    it('al 100 % avisa y deja de responder; los avisos no vuelven a salir en el mes', async () => {
      await fillUsage(99);
      llm.respondWith('{"reply":"Última del mes"}');
      await say(newCustomer(), 'Hola');
      expect((await quotaBell()).filter((n: { title: string }) => /100 %/.test(n.title))).toHaveLength(1);

      llm.reset();
      const phone = newCustomer();
      await say(phone, 'Hola');
      expect(llm.calls).toHaveLength(0);
      const conversation = await conversationOf(team.owner.api, `+${phone}`);
      const messages = (await team.owner.api.get(`/api/v1/conversations/${conversation.id}/messages`).expect(200)).body;
      expect(messages.filter((m: { aiGenerated: boolean }) => m.aiGenerated)).toHaveLength(0);
      expect((await team.owner.api.get('/api/v1/ai/interactions?outcome=quota').expect(200)).body.items).toHaveLength(1);
      expect((await quotaBell()).filter((n: { title: string }) => /100 %/.test(n.title))).toHaveLength(1);
    });

    it('con el bloqueo apagado sigue respondiendo después del 100 %', async () => {
      await fillUsage(100);
      await team.owner.api.put('/api/v1/ai/agent', { blockOnQuota: false }).expect(200);
      llm.respondWith('{"reply":"Sigo atendiendo"}');
      await say(newCustomer(), 'Hola');
      expect(llm.calls).toHaveLength(1);
      expect((await team.owner.api.get('/api/v1/ai/usage').expect(200)).body).toMatchObject({ used: 101, exhausted: true, blockOnQuota: false });
      await team.owner.api.put('/api/v1/ai/agent', { blockOnQuota: true }).expect(200);
      await fillUsage(0);
    });
  });

  describe('Registro de conversaciones de IA (E05-S08)', () => {
    it('guarda prompt, respuesta, modelo, tokens y costo; solo lo ve el propietario', async () => {
      const phone = newCustomer();
      llm.respondWith('{"reply":"Cuesta $1.200.000 al mes."}');
      await say(phone, '¿Cuánto cuesta?');
      const list = (await team.owner.api.get('/api/v1/ai/interactions').expect(200)).body;
      const item = list.items[0];
      expect(item).toMatchObject({ channel: 'whatsapp', outcome: 'replied', model: 'local', contactName: expect.any(String) });
      expect(item.inputTokens).toBeGreaterThan(0);
      expect(item.costMicros).toBe(Math.round(item.inputTokens * 0.59 + item.outputTokens * 0.79));
      expect(list.month.interactions).toBeGreaterThan(0);

      const detail = (await team.owner.api.get(`/api/v1/ai/interactions/${item.id}`).expect(200)).body;
      expect(detail.prompt.system).toContain('Reglas que siempre aplican');
      expect(detail.prompt.messages.at(-1)).toEqual({ role: 'user', content: '¿Cuánto cuesta?' });
      expect(detail.response).toBe('{"reply":"Cuesta $1.200.000 al mes."}');

      await team.admin.api.get('/api/v1/ai/interactions').expect(403);
      await team.seller.api.get(`/api/v1/ai/interactions/${item.id}`).expect(403);
    });

    it('el registro no se puede editar y se borra con la conversación (supresión del titular)', async () => {
      const { rows: [row] } = await t.owner.query(`SELECT id, conversation_id FROM ai_interactions WHERE tenant_id = $1 AND conversation_id IS NOT NULL LIMIT 1`, [tenantId]);
      const app = await t.owner.query(`SELECT has_table_privilege('beecrm_app', 'ai_interactions', 'UPDATE') AS can`);
      expect(app.rows[0].can).toBe(false);
      await t.owner.query(`DELETE FROM conversations WHERE id = $1`, [row.conversation_id]);
      expect((await t.owner.query(`SELECT 1 FROM ai_interactions WHERE id = $1`, [row.id])).rowCount).toBe(0);
    });

    it('otra empresa no ve el registro ajeno', async () => {
      const other = (await createTeam(t, 'Otra de registro')).owner.api;
      expect((await other.get('/api/v1/ai/interactions').expect(200)).body.items).toEqual([]);
    });
  });
});
