import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, registerAndLogin, type TestApp } from './support/test-app.js';

/** E15-S03 — Métricas y correlación de requests. */
describe('Observabilidad (E15-S03)', () => {
  let t: TestApp;
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.close());

  it('cada respuesta trae un x-request-id (generado o el que mandó el cliente)', async () => {
    const generated = await t.http().get('/api/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const propagated = await t.http().get('/api/health').set('x-request-id', 'trace-abc-123');
    expect(propagated.headers['x-request-id']).toBe('trace-abc-123');
  });

  // Node ya rechaza saltos de línea en headers; estos son los que SÍ llegan al servidor.
  it.each([
    ['comillas y JSON', 'x" injected="1 {"level":60}'],
    ['espacios', 'id con espacios'],
    ['demasiado largo', 'a'.repeat(200)],
  ])('ignora un x-request-id inseguro: %s', async (_, value) => {
    const res = await t.http().get('/api/health').set('x-request-id', value);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('expone métricas Prometheus con latencia por PATRÓN de ruta, no por URL', async () => {
    const { agent } = await registerAndLogin(t);
    await agent.delete('/api/v1/members/id-que-no-existe-123').set('Origin', 'http://localhost:5173');

    const res = await t.http().get('/api/metrics').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('http_request_duration_seconds_bucket');
    expect(res.text).toMatch(/http_requests_total\{[^}]*route="\/api\/v1\/members\/:id"[^}]*status="404"/);
    expect(res.text).not.toContain('id-que-no-existe-123');
    expect(res.text).toContain('process_cpu_user_seconds_total');
  });

  it('agrupa rutas desconocidas en una sola etiqueta', async () => {
    await t.http().get('/api/ruta/inventada/abc');
    await t.http().get('/api/otra/inventada/xyz');
    const res = await t.http().get('/api/metrics');
    expect(res.text).toMatch(/route="unmatched"/);
    expect(res.text).not.toContain('inventada');
  });
});
