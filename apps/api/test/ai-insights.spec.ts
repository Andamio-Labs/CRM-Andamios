import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LocalLlm } from '../src/shared/ai/llm.js';
import { LLM_PROVIDER } from '../src/shared/tokens.js';
import { createTeam, createTestApp, type TestApp } from './support/test-app.js';
import { connectChannel, conversationOf, inboundText, newPhoneId, sendWebhook } from './support/whatsapp.js';

let n = 0;
const phone = () => `5737${String(Date.now()).slice(-6)}${String(n++).padStart(2, '0')}`;

/** E05-S10 — Resumen del cliente, temperatura y próximo paso con un clic. */
describe('Resumen IA del cliente (E05-S10)', () => {
  let t: TestApp;
  let llm: LocalLlm;
  let team: Awaited<ReturnType<typeof createTeam>>;
  let pnid: string;

  /** Cliente que escribe por WhatsApp; devuelve su negocio y su conversación. */
  async function leadSaying(text: string) {
    const from = phone();
    await sendWebhook(t, inboundText(pnid, from, text)).expect(200);
    const conversation = await conversationOf(team.owner.api, `+${from}`);
    const dealId = (await t.owner.query(`SELECT id FROM deals WHERE contact_id = $1`, [conversation.contact.id])).rows[0].id as string;
    return { dealId, conversationId: conversation.id as string };
  }

  beforeAll(async () => {
    t = await createTestApp({ LLM_API: 'local' });
    llm = t.app.get(LLM_PROVIDER) as LocalLlm;
    team = await createTeam(t, 'Resumen SAS');
    pnid = newPhoneId();
    await connectChannel(team.owner.api, pnid).expect(201);
  });
  afterAll(() => t.close());
  beforeEach(() => llm.reset());

  it('resume la conversación, la guarda como nota interna y registra el costo sin gastar la cuota', async () => {
    const { dealId, conversationId } = await leadSaying('Necesito 40 cuerpos de andamio para el lunes');
    llm.respondWith(JSON.stringify({ summary: 'Constructora que necesita 40 cuerpos para el lunes.', temperature: 'caliente', nextStep: 'Confirmar disponibilidad hoy.', reply: '¡Hola! Ya revisamos disponibilidad.' }));

    const insight = (await team.owner.api.post(`/api/v1/deals/${dealId}/insights`).expect(200)).body;
    expect(insight).toEqual({
      summary: 'Constructora que necesita 40 cuerpos para el lunes.', temperature: 'caliente', nextStep: 'Confirmar disponibilidad hoy.',
      reply: '¡Hola! Ya revisamos disponibilidad.', savedAsNote: true,
    });
    expect(llm.calls[0]!.system).toContain('[cliente] Necesito 40 cuerpos de andamio para el lunes');

    const thread = (await team.owner.api.get(`/api/v1/conversations/${conversationId}/messages`).expect(200)).body as { direction: string; body: string }[];
    expect(thread.find((m) => m.direction === 'note')?.body).toBe('✦ Resumen IA\nConstructora que necesita 40 cuerpos para el lunes.\nTemperatura: Caliente\nPróximo paso: Confirmar disponibilidad hoy.');
    const { rows } = await t.owner.query(`SELECT channel, outcome FROM ai_interactions WHERE conversation_id = $1`, [conversationId]);
    expect(rows).toEqual([{ channel: 'insight', outcome: 'replied' }]);
    expect((await team.owner.api.get('/api/v1/ai/usage').expect(200)).body.used).toBe(0);
  });

  it('sin guion, el simulador local responde con el formato correcto', async () => {
    const { dealId } = await leadSaying('¿Tienen andamios colgantes?');
    const insight = (await team.owner.api.post(`/api/v1/deals/${dealId}/insights`).expect(200)).body;
    expect(insight.summary).toContain('¿Tienen andamios colgantes?');
    expect(['frio', 'tibio', 'caliente']).toContain(insight.temperature);
  });

  it('si el modelo responde sin formato: 502 y queda el error en el registro, sin nota', async () => {
    const { dealId, conversationId } = await leadSaying('Hola');
    llm.respondWith('No puedo ayudarte con eso.');
    expect((await team.owner.api.post(`/api/v1/deals/${dealId}/insights`).expect(502)).body.code).toBe('AI_FAILED');
    const thread = (await team.owner.api.get(`/api/v1/conversations/${conversationId}/messages`).expect(200)).body as { direction: string }[];
    expect(thread.some((m) => m.direction === 'note')).toBe(false);
    expect((await t.owner.query(`SELECT outcome FROM ai_interactions WHERE conversation_id = $1`, [conversationId])).rows).toEqual([{ outcome: 'error' }]);
  });

  it('un negocio sin conversación también se resume, pero no deja nota', async () => {
    const pipeline = (await team.owner.api.get('/api/v1/pipelines').expect(200)).body[0];
    const deal = (await team.owner.api.post('/api/v1/deals', { title: 'Referido de un cliente', pipelineId: pipeline.id }).expect(201)).body;
    const insight = (await team.owner.api.post(`/api/v1/deals/${deal.id}/insights`).expect(200)).body;
    expect(insight).toMatchObject({ savedAsNote: false, temperature: 'frio' });
  });

  it('respeta la visibilidad y el aislamiento entre empresas', async () => {
    const { dealId } = await leadSaying('Hola');
    const other = await createTeam(t, 'Otra del resumen');
    await other.owner.api.post(`/api/v1/deals/${dealId}/insights`).expect(404);
  });
});

describe('Resumen IA sin proveedor configurado', () => {
  let t: TestApp;
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.close());

  it('explica que falta conectar la IA', async () => {
    const team = await createTeam(t, 'Sin IA SAS');
    const pipeline = (await team.owner.api.get('/api/v1/pipelines').expect(200)).body[0];
    const deal = (await team.owner.api.post('/api/v1/deals', { title: 'X', pipelineId: pipeline.id }).expect(201)).body;
    expect((await team.owner.api.post(`/api/v1/deals/${deal.id}/insights`).expect(409)).body.code).toBe('AI_NOT_CONFIGURED');
  });
});
