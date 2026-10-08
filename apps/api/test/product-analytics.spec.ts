import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, registerAndLogin, createTestApp, type TestApp } from './support/test-app.js';
import { connectChannel } from './support/whatsapp.js';

const TOKEN = 'token-interno-de-metricas-123456';

/** E08-S04 — Embudo de activación propio: registro → WhatsApp conectado → primer lead. Solo agregados. */
describe('Analítica de producto interna (E08-S04)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ METRICS_TOKEN: TOKEN });
  });
  afterAll(() => t.close());

  const funnel = async () => (await t.http().get('/api/internal/activation-funnel').set('Authorization', `Bearer ${TOKEN}`).expect(200)).body;

  it('cuenta empresas por paso de activación y el tiempo mediano hasta cada uno, sin datos de las empresas', async () => {
    const before = await funnel();
    const solo = await registerAndLogin(t, 'Solo Registro SAS');
    const activa = await registerAndLogin(t, 'Activa SAS');
    await connectChannel(as(activa.agent)).expect(201);
    await as(activa.agent).post('/api/v1/contacts', { name: 'Primer lead' }).expect(201);

    // Otros archivos de test registran empresas en paralelo contra la misma base: los conteos crecen "al menos".
    const after = await funnel();
    expect(after.registered - before.registered).toBeGreaterThanOrEqual(2);
    expect(after.whatsappConnected - before.whatsappConnected).toBeGreaterThanOrEqual(1);
    expect(after.firstLead - before.firstLead).toBeGreaterThanOrEqual(1);
    expect(after.firstLead).toBeLessThanOrEqual(after.registered);
    expect(after.steps.map((s: { key: string }) => s.key)).toEqual(['registered', 'whatsapp_connected', 'first_lead', 'first_deal_won']);
    expect(after.medianHoursToFirstLead).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(after)).not.toMatch(/Solo Registro|Activa SAS|@/);
    expect(solo).toBeTruthy();
  });

  it('filtra por cohorte de registro', async () => {
    const r = (await t.http().get('/api/internal/activation-funnel?from=2020-01-01&to=2020-12-31').set('Authorization', `Bearer ${TOKEN}`).expect(200)).body;
    expect(r.registered).toBe(0);
  });

  it('sin el token no responde', async () => {
    await t.http().get('/api/internal/activation-funnel').expect(401);
    await t.http().get('/api/internal/activation-funnel').set('Authorization', 'Bearer otro').expect(401);
  });
});
