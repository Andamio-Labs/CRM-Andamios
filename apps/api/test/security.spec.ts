import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_URL, createTeam, createTestApp, STRONG_PASSWORD, type TestApp, uniqueEmail } from './support/test-app.js';

/** Regresiones de la auditoría 001 (anti-slop/audit-001-2026-10-06.md). */
describe('Seguridad (auditoría 001)', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Segura');
  });
  afterAll(() => t.close());

  it.each([
    ['patch', '/api/v1/custom-fields/no-es-uuid'],
    ['patch', '/api/v1/companies/no-es-uuid'],
    ['del', '/api/v1/companies/no-es-uuid/contacts/tampoco'],
    ['del', '/api/v1/custom-fields/no-es-uuid'],
    ['get', '/api/v1/deals/123'],
  ] as const)('#3 id mal formado en %s %s → 404/400, nunca 500', async (method, url) => {
    const res = method === 'get' ? await team.owner.api.get(url) : method === 'del' ? await team.owner.api.del(url) : await team.owner.api.patch(url, { label: 'x', name: 'x' });
    expect([400, 404]).toContain(res.status);
  });

  it('#4 la ruta de registro de Better Auth está cerrada (solo /api/v1/registrations)', async () => {
    await t.http().post('/api/auth/sign-up/email').set('Origin', APP_URL)
      .send({ email: uniqueEmail(), password: STRONG_PASSWORD, name: 'Colado' }).expect(404);
  });

  it('#5 una mutación con Origin de otro sitio se rechaza (CSRF)', async () => {
    await team.owner.agent.post('/api/v1/contacts').set('Origin', 'https://sitio-malicioso.com').send({ name: 'CSRF' }).expect(403);
    await team.owner.agent.post('/api/v1/contacts').set('Origin', APP_URL).send({ name: 'Legítimo' }).expect(201);
  });

  it('#6 responde con cabeceras de seguridad', async () => {
    const res = await t.http().get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('Rate limit por IP (auditoría #4)', () => {
  let t: TestApp;
  beforeAll(async () => (t = await createTestApp({ RATE_LIMIT_PUBLIC_PER_MINUTE: '3' })));
  afterAll(() => t.close());

  it('corta el registro masivo desde una misma IP', async () => {
    const register = () => t.http().post('/api/v1/registrations')
      .send({ acceptLegal: true, companyName: 'Spam', name: 'Bot', email: uniqueEmail('bot'), password: STRONG_PASSWORD });
    for (let i = 0; i < 3; i++) expect((await register()).status).toBe(202);
    const blocked = await register();
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('corta el password spraying: muchos logins desde una IP, aunque sean correos distintos', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await t.http().post('/api/auth/sign-in/email').set('Origin', APP_URL).send({ email: uniqueEmail(), password: 'Probando1234!' })).status);
    }
    expect(statuses.at(-1)).toBe(429);
  });
});

describe('Métricas protegidas (auditoría #7)', () => {
  let t: TestApp;
  beforeAll(async () => (t = await createTestApp({ METRICS_TOKEN: 'token-de-metricas-bien-largo' })));
  afterAll(() => t.close());

  it('con METRICS_TOKEN configurado exige el token', async () => {
    await t.http().get('/api/metrics').expect(401);
    await t.http().get('/api/metrics').set('Authorization', 'Bearer otro').expect(401);
    await t.http().get('/api/metrics').set('Authorization', 'Bearer token-de-metricas-bien-largo').expect(200);
  });
});
