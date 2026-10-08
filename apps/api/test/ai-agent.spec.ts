import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LlmProvider, LlmRequest } from '../src/shared/ai/llm.js';
import { LLM_PROVIDER } from '../src/shared/tokens.js';
import { createTeam, createTestApp, type TestApp } from './support/test-app.js';

/** E05-S01 — Configuración del agente. Sin proveedor de IA real todavía (decisión 2026-10-08). */
describe('Configuración del agente (E05-S01)', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;

  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Agente SAS');
  });
  afterAll(() => t.close());

  it('arranca con valores por defecto, apagado y sin IA configurada', async () => {
    const agent = (await team.owner.api.get('/api/v1/ai/agent').expect(200)).body;
    expect(agent).toMatchObject({ name: 'Asistente', tone: 'friendly', language: 'es-CO', schedule: 'always', instructions: '', enabled: false, aiConfigured: false });
  });

  it('propietario y admin editan nombre, tono, idioma, horario e instrucciones; el vendedor no', async () => {
    const config = { name: 'Abeja', tone: 'formal', language: 'es-MX', schedule: 'out_of_hours', instructions: 'Vendemos andamios. Horario: lunes a viernes.' };
    const saved = (await team.admin.api.put('/api/v1/ai/agent', config).expect(200)).body;
    expect(saved).toMatchObject(config);
    expect((await team.owner.api.get('/api/v1/ai/agent').expect(200)).body).toMatchObject(config);
    await team.seller.api.get('/api/v1/ai/agent').expect(403);
    await team.seller.api.put('/api/v1/ai/agent', config).expect(403);
  });

  it('valida tono, idioma, horario y largo de las instrucciones', async () => {
    const put = (body: object) => team.owner.api.put('/api/v1/ai/agent', body);
    await put({ tone: 'grosero' }).expect(400);
    await put({ language: 'en-US' }).expect(400);
    await put({ schedule: 'a_veces' }).expect(400);
    await put({ instructions: 'x'.repeat(8001) }).expect(400);
    await put({ name: '' }).expect(400);
  });

  it('no se puede activar sin un proveedor de IA configurado', async () => {
    const res = await team.owner.api.put('/api/v1/ai/agent', { enabled: true }).expect(409);
    expect(res.body.code).toBe('AI_NOT_CONFIGURED');
  });

  it('el simulador muestra el prompt armado y avisa que falta la IA', async () => {
    const res = (await team.owner.api.post('/api/v1/ai/agent/preview', { message: '¿Cuánto cuesta un andamio?' }).expect(200)).body;
    expect(res.reply).toBeNull();
    expect(res.aiConfigured).toBe(false);
    expect(res.systemPrompt).toContain('Abeja');
    expect(res.systemPrompt).toContain('Vendemos andamios.');
  });

  it('otra empresa no ve la configuración ajena', async () => {
    const other = (await createTeam(t, 'Otra de agente')).owner.api;
    expect((await other.get('/api/v1/ai/agent').expect(200)).body.name).toBe('Asistente');
  });
});

describe('Simulador con un proveedor de IA (E05-S01)', () => {
  const calls: LlmRequest[] = [];
  const fake: LlmProvider = {
    configured: true,
    complete: async (req) => {
      calls.push(req);
      return { text: 'Un andamio cuesta según la altura.', model: 'fake', inputTokens: 10, outputTokens: 8 };
    },
  };
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({}, (builder) => builder.overrideProvider(LLM_PROVIDER).useValue(fake));
  });
  afterAll(() => t.close());

  it('envía el prompt del agente y el mensaje de prueba; devuelve la respuesta; permite activarlo', async () => {
    const { owner } = await createTeam(t, 'Agente con IA');
    await owner.api.put('/api/v1/ai/agent', { name: 'Abeja', instructions: 'Solo andamios.', enabled: true }).expect(200);
    const res = (await owner.api.post('/api/v1/ai/agent/preview', { message: 'Hola' }).expect(200)).body;
    expect(res).toMatchObject({ reply: 'Un andamio cuesta según la altura.', aiConfigured: true });
    expect(calls.at(-1)!.system).toContain('Solo andamios.');
    expect(calls.at(-1)!.messages).toEqual([{ role: 'user', content: 'Hola' }]);
  });
});
