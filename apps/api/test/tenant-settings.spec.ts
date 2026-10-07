import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_URL, createTestApp, registerAndLogin, type TestApp } from './support/test-app.js';

/** E01-S06 — Configuración de empresa, editable por el propietario. */
describe('/api/v1/tenant/settings (E01-S06)', () => {
  let t: TestApp;
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.close());

  it('devuelve los valores por defecto para Colombia', async () => {
    const { agent } = await registerAndLogin(t);
    const res = await agent.get('/api/v1/tenant/settings').expect(200);
    expect(res.body).toMatchObject({ timezone: 'America/Bogota', currency: 'COP', locale: 'es-CO' });
    expect(res.body.businessHours.mon).toEqual([{ from: '08:00', to: '18:00' }]);
  });

  it('el propietario edita zona horaria, moneda, idioma y horario', async () => {
    const { agent } = await registerAndLogin(t);
    const businessHours = {
      mon: [{ from: '09:00', to: '13:00' }, { from: '14:00', to: '19:00' }],
      tue: [], wed: [], thu: [], fri: [], sat: [], sun: [],
    };
    const res = await agent
      .patch('/api/v1/tenant/settings')
      .set('Origin', APP_URL)
      .send({ timezone: 'America/Mexico_City', currency: 'MXN', locale: 'es-MX', businessHours })
      .expect(200);
    expect(res.body).toMatchObject({ timezone: 'America/Mexico_City', currency: 'MXN', locale: 'es-MX', businessHours });
  });

  it.each([
    ['zona horaria inexistente', { timezone: 'America/Macondo' }],
    ['moneda no ISO', { currency: 'PESOS' }],
    ['idioma no soportado', { locale: 'fr-FR' }],
    ['horario al revés', { businessHours: { mon: [{ from: '18:00', to: '08:00' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } }],
  ])('rechaza con 400: %s', async (_, body) => {
    const { agent } = await registerAndLogin(t);
    await agent.patch('/api/v1/tenant/settings').set('Origin', APP_URL).send(body).expect(400);
  });

  it('sin sesión responde 401', async () => {
    await request(t.app.getHttpServer()).get('/api/v1/tenant/settings').expect(401);
  });

  it('un admin (no propietario) puede ver pero no editar', async () => {
    const { email: ownerEmail } = await registerAndLogin(t, 'Empresa del dueño');
    const { agent: adminAgent, email: adminEmail } = await registerAndLogin(t, 'Empresa descartable');

    // Mueve al segundo usuario a la empresa del primero como admin.
    await t.owner.query(
      `UPDATE member SET "organizationId" = (
         SELECT m."organizationId" FROM member m JOIN "user" u ON u.id = m."userId" WHERE u.email = $1
       ), role = 'admin'
       WHERE "userId" = (SELECT id FROM "user" WHERE email = $2)`,
      [ownerEmail, adminEmail],
    );
    await t.owner.query(`DELETE FROM session WHERE "userId" = (SELECT id FROM "user" WHERE email = $1)`, [adminEmail]);
    await adminAgent.post('/api/auth/sign-in/email').set('Origin', APP_URL)
      .send({ email: adminEmail, password: 'Colombia2026!' }).expect(200);

    await adminAgent.get('/api/v1/tenant/settings').expect(200);
    await adminAgent.patch('/api/v1/tenant/settings').set('Origin', APP_URL).send({ timezone: 'UTC' }).expect(403);
  });
});
