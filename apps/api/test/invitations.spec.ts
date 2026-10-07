import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  APP_URL,
  createTestApp,
  inviteAndJoin,
  registerAndLogin,
  STRONG_PASSWORD,
  type TestApp,
  uniqueEmail,
} from './support/test-app.js';

/** E01-S03 — Invitar usuarios por correo. */
describe('Invitaciones (E01-S03)', () => {
  let t: TestApp;
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.close());

  const invite = (agent: request.Agent, email: string, role = 'member') =>
    agent.post('/api/v1/invitations').set('Origin', APP_URL).send({ email, role });

  function invitationIdFor(email: string) {
    return new URL(t.mailer.lastLinkTo(email)).pathname.split('/').pop()!;
  }

  it('el propietario invita: llega un correo con enlace que vence en 7 días', async () => {
    const { agent } = await registerAndLogin(t, 'Clínica Norte');
    const email = uniqueEmail('vendedora');
    await invite(agent, email).expect(201);

    const link = t.mailer.lastLinkTo(email);
    expect(link).toMatch(new RegExp(`^${APP_URL}/invitations/`));
    const { rows } = await t.owner.query(`SELECT "expiresAt", role, status FROM invitation WHERE id = $1`, [invitationIdFor(email)]);
    expect(rows[0]).toMatchObject({ role: 'member', status: 'pending' });
    const days = (rows[0].expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('el vendedor no puede invitar; el admin no puede invitar admins', async () => {
    const owner = await registerAndLogin(t);
    const admin = await inviteAndJoin(t, owner.agent, 'admin');
    const seller = await inviteAndJoin(t, owner.agent, 'member');
    await invite(seller.agent, uniqueEmail()).expect(403);
    await invite(admin.agent, uniqueEmail(), 'admin').expect(403);
  });

  it('no se puede invitar a alguien como propietario', async () => {
    const { agent } = await registerAndLogin(t);
    await invite(agent, uniqueEmail(), 'owner').expect(400);
  });

  it('respeta el límite de usuarios del plan, contando invitaciones pendientes', async () => {
    const { agent } = await registerAndLogin(t); // trial: 3 usuarios
    await invite(agent, uniqueEmail()).expect(201);
    await invite(agent, uniqueEmail()).expect(201);
    const res = await invite(agent, uniqueEmail()).expect(409);
    expect(res.body.code).toBe('PLAN_USER_LIMIT_REACHED');
  });

  it('una persona nueva acepta, crea su clave y entra sin verificar otra vez el correo', async () => {
    const { agent } = await registerAndLogin(t, 'Inmobiliaria Sur');
    const email = uniqueEmail('nuevo');
    await invite(agent, email, 'admin').expect(201);
    const id = invitationIdFor(email);

    const info = await t.http().get(`/api/v1/invitations/${id}`).expect(200);
    expect(info.body).toMatchObject({ organizationName: 'Inmobiliaria Sur', email, role: 'admin', status: 'pending', accountExists: false });

    await t.http().post(`/api/v1/invitations/${id}/accept`).send({ acceptLegal: true, name: 'Nuevo Admin', password: STRONG_PASSWORD }).expect(201);
    const login = await t.http().post('/api/auth/sign-in/email').set('Origin', APP_URL).send({ email, password: STRONG_PASSWORD });
    expect(login.status).toBe(200);
  });

  it('no se puede aceptar dos veces ni una invitación vencida', async () => {
    const { agent } = await registerAndLogin(t);
    const first = uniqueEmail();
    const second = uniqueEmail();
    await invite(agent, first).expect(201);
    await invite(agent, second).expect(201);

    const body = { acceptLegal: true, name: 'Persona', password: STRONG_PASSWORD };
    await t.http().post(`/api/v1/invitations/${invitationIdFor(first)}/accept`).send(body).expect(201);
    await t.http().post(`/api/v1/invitations/${invitationIdFor(first)}/accept`).send(body).expect(410);

    await t.owner.query(`UPDATE invitation SET "expiresAt" = now() - interval '1 minute' WHERE id = $1`, [invitationIdFor(second)]);
    await t.http().post(`/api/v1/invitations/${invitationIdFor(second)}/accept`).send(body).expect(410);
  });

  it('si el correo ya tiene cuenta, debe iniciar sesión para aceptar', async () => {
    const companyA = await registerAndLogin(t, 'Empresa A');
    const companyB = await registerAndLogin(t, 'Empresa B');
    await invite(companyA.agent, companyB.email).expect(201);
    const id = invitationIdFor(companyB.email);

    expect((await t.http().get(`/api/v1/invitations/${id}`)).body.accountExists).toBe(true);
    const anon = await t.http().post(`/api/v1/invitations/${id}/accept`).send({ acceptLegal: true, name: 'X', password: STRONG_PASSWORD });
    expect(anon.status).toBe(409);
    expect(anon.body.code).toBe('LOGIN_REQUIRED');

    await companyB.agent.post(`/api/v1/invitations/${id}/accept`).set('Origin', APP_URL).send({}).expect(201);
    const { rows } = await t.owner.query(
      `SELECT count(*)::int AS n FROM member m JOIN "user" u ON u.id = m."userId" WHERE u.email = $1`,
      [companyB.email],
    );
    expect(rows[0].n).toBe(2);
  });

  it('otra persona logueada no puede aceptar una invitación ajena', async () => {
    const companyA = await registerAndLogin(t);
    const intruder = await registerAndLogin(t);
    const email = uniqueEmail('destinatario');
    await invite(companyA.agent, email).expect(201);
    await intruder.agent.post(`/api/v1/invitations/${invitationIdFor(email)}/accept`).set('Origin', APP_URL).send({}).expect(403);
  });

  it.each(['invite-member', 'update-member-role', 'remove-member', 'accept-invitation', 'create'])(
    'la ruta de Better Auth /organization/%s está cerrada (solo se usa /api/v1)',
    async (route) => {
      const { agent } = await registerAndLogin(t);
      await agent.post(`/api/auth/organization/${route}`).set('Origin', APP_URL).send({ email: uniqueEmail(), role: 'admin' }).expect(404);
    },
  );

  it('propietario y admin pueden cancelar una invitación pendiente', async () => {
    const { agent } = await registerAndLogin(t);
    const email = uniqueEmail();
    await invite(agent, email).expect(201);
    const pending = await agent.get('/api/v1/invitations').expect(200);
    expect(pending.body.map((i: { email: string }) => i.email)).toContain(email);

    await agent.delete(`/api/v1/invitations/${invitationIdFor(email)}`).set('Origin', APP_URL).expect(204);
    await t.http().post(`/api/v1/invitations/${invitationIdFor(email)}/accept`).send({ acceptLegal: true, name: 'X', password: STRONG_PASSWORD }).expect(410);
  });
});
