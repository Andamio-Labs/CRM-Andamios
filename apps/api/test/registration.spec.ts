import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, STRONG_PASSWORD, type TestApp, uniqueEmail } from './support/test-app.js';

/** E01-S01 — Registro de empresa y usuario propietario. */
describe('POST /api/v1/registrations (E01-S01)', () => {
  let t: TestApp;
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.close());

  it('crea tenant + propietario, envía verificación y asigna plan de prueba', async () => {
    const email = uniqueEmail('ana');
    const res = await t
      .http()
      .post('/api/v1/registrations')
      .send({ acceptLegal: true, companyName: 'Clínica Sonrisas', name: 'Ana Gómez', email, password: STRONG_PASSWORD });

    expect(res.status).toBe(202);

    const { rows: users } = await t.owner.query(`SELECT id, "emailVerified" FROM "user" WHERE email = $1`, [email]);
    expect(users).toHaveLength(1);
    expect(users[0].emailVerified).toBe(false);

    const { rows: memberships } = await t.owner.query(
      `SELECT m.role, o.id AS tenant_id, o.name FROM member m JOIN organization o ON o.id = m."organizationId"
       WHERE m."userId" = $1`,
      [users[0].id],
    );
    expect(memberships).toEqual([expect.objectContaining({ role: 'owner', name: 'Clínica Sonrisas' })]);
    const tenantId = memberships[0].tenant_id;

    const { rows: settings } = await t.owner.query(`SELECT timezone, currency, locale FROM tenant_settings WHERE tenant_id = $1`, [tenantId]);
    expect(settings[0]).toEqual({ timezone: 'America/Bogota', currency: 'COP', locale: 'es-CO' });

    const { rows: subs } = await t.owner.query(`SELECT plan, status, trial_ends_at FROM subscriptions WHERE tenant_id = $1`, [tenantId]);
    expect(subs[0]).toMatchObject({ plan: 'trial', status: 'trialing' });
    const trialDays = (subs[0].trial_ends_at.getTime() - Date.now()) / 86_400_000;
    expect(trialDays).toBeGreaterThan(13.9);
    expect(trialDays).toBeLessThanOrEqual(14);

    expect(t.mailer.lastLinkTo(email)).toMatch(/\/api\/auth\/verify-email\?token=/);
  });

  it.each([
    ['correo inválido', { email: 'no-es-correo' }],
    ['clave corta', { password: 'corta' }],
    ['sin empresa', { companyName: '' }],
    ['sin nombre', { name: ' ' }],
  ])('rechaza con 400: %s', async (_, override) => {
    const body = { acceptLegal: true, companyName: 'Empresa', name: 'Luis', email: uniqueEmail(), password: STRONG_PASSWORD, ...override };
    const res = await t.http().post('/api/v1/registrations').send(body);
    expect(res.status).toBe(400);
  });

  it('dos registros simultáneos con el mismo correo: ambos 202, una sola cuenta y una sola empresa', async () => {
    const email = uniqueEmail('carrera');
    const body = { acceptLegal: true, companyName: 'Doble clic', name: 'Ana', email, password: STRONG_PASSWORD };
    const responses = await Promise.all([1, 2, 3].map(() => t.http().post('/api/v1/registrations').send(body)));
    expect(responses.map((r) => r.status)).toEqual([202, 202, 202]);
    const { rows } = await t.owner.query(
      `SELECT count(DISTINCT u.id)::int AS users, count(m.id)::int AS members FROM "user" u LEFT JOIN member m ON m."userId" = u.id WHERE u.email = $1`,
      [email],
    );
    expect(rows[0]).toEqual({ users: 1, members: 1 });
  });

  it('con un correo ya registrado responde igual (no revela cuentas) y no crea otra empresa', async () => {
    const email = uniqueEmail('dup');
    const body = { acceptLegal: true, companyName: 'Primera', name: 'Ana', email, password: STRONG_PASSWORD };
    const first = await t.http().post('/api/v1/registrations').send(body);
    const second = await t.http().post('/api/v1/registrations').send({ ...body, companyName: 'Segunda' });

    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    const { rows } = await t.owner.query(
      `SELECT count(*)::int AS n FROM member m JOIN "user" u ON u.id = m."userId" WHERE u.email = $1`,
      [email],
    );
    expect(rows[0].n).toBe(1);
  });
});
