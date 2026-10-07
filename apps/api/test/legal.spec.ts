import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, STRONG_PASSWORD, type TestApp, uniqueEmail } from './support/test-app.js';

/** E13-S01 — Aceptación de términos y aviso de privacidad con versión, fecha e IP. */
describe('Términos y privacidad (E13-S01)', () => {
  let t: TestApp;
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.close());

  it('publica las versiones vigentes', async () => {
    const res = await t.http().get('/api/v1/legal').expect(200);
    expect(res.body).toMatchObject({ terms: { version: expect.any(String) }, privacy: { version: expect.any(String) } });
  });

  it('el registro exige aceptar', async () => {
    await t.http().post('/api/v1/registrations')
      .send({ companyName: 'Sin aceptar', name: 'Ana', email: uniqueEmail(), password: STRONG_PASSWORD }).expect(400);
  });

  it('registra versión, fecha, IP y navegador de cada documento', async () => {
    const email = uniqueEmail('legal');
    const { body: legal } = await t.http().get('/api/v1/legal');
    await t.http().post('/api/v1/registrations').set('User-Agent', 'Navegador de prueba/1.0')
      .send({ acceptLegal: true, companyName: 'Acepta', name: 'Ana', email, password: STRONG_PASSWORD }).expect(202);

    const { rows } = await t.owner.query(
      `SELECT la.document, la.version, la.ip::text AS ip, la.user_agent, la.accepted_at
       FROM legal_acceptances la JOIN "user" u ON u.id = la.user_id WHERE u.email = $1 ORDER BY document`,
      [email],
    );
    expect(rows.map((r) => [r.document, r.version])).toEqual([['privacy', legal.privacy.version], ['terms', legal.terms.version]]);
    expect(rows[0].ip).toMatch(/127\.0\.0\.1|::1|::ffff:127\.0\.0\.1/);
    expect(rows[0].user_agent).toBe('Navegador de prueba/1.0');
    expect(Date.now() - rows[0].accepted_at.getTime()).toBeLessThan(60_000);
  });

  it('el registro de aceptaciones es inmutable para la aplicación', async () => {
    const res = await t.owner.query(`SELECT has_table_privilege('beecrm_app', 'legal_acceptances', 'UPDATE') AS u, has_table_privilege('beecrm_app', 'legal_acceptances', 'DELETE') AS d`);
    expect(res.rows[0]).toEqual({ u: false, d: false });
  });
});
