import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BillingService } from '../src/modules/billing/application/billing.service.js';
import { createTeam, createTestApp, type TestApp } from './support/test-app.js';

/** E10-S02 — Prueba gratuita sin tarjeta; al vencer, solo lectura sin perder datos. */
describe('Prueba gratuita (E10-S02)', () => {
  let t: TestApp;
  let billing: BillingService;

  beforeAll(async () => {
    t = await createTestApp({ TRIAL_DAYS: '30' });
    billing = t.app.get(BillingService);
  });
  afterAll(() => t.close());

  async function expiredTeam(name: string) {
    const team = await createTeam(t, name);
    const contactId = (await team.owner.api.post('/api/v1/contacts', { name: 'Cliente previo' }).expect(201)).body.id as string;
    await t.owner.query(`UPDATE subscriptions s SET trial_ends_at = now() - interval '1 minute' FROM member m JOIN "user" u ON u.id = m."userId"
      WHERE m."organizationId" = s.tenant_id AND u.email = $1`, [team.owner.email]);
    return { team, contactId };
  }

  it('dura lo configurado y no pide tarjeta', async () => {
    const team = await createTeam(t, 'Prueba 30 SAS');
    const plan = (await team.seller.api.get('/api/v1/plan').expect(200)).body;
    expect(plan).toMatchObject({ plan: 'trial', status: 'trialing' });
    expect(Math.round((Date.parse(plan.trialEndsAt) - Date.now()) / 86_400_000)).toBe(30);
    await team.owner.api.post('/api/v1/contacts', { name: 'Sin tarjeta' }).expect(201);
  });

  it('al vencer: se lee todo, no se modifica nada y los datos siguen intactos', async () => {
    const { team, contactId } = await expiredTeam('Vencida SAS');
    expect((await team.seller.api.get('/api/v1/plan').expect(200)).body.status).toBe('read_only');
    expect((await team.owner.api.get(`/api/v1/contacts/${contactId}`).expect(200)).body.name).toBe('Cliente previo');
    await team.seller.api.get('/api/v1/contacts').expect(200);

    const blocked = await team.owner.api.post('/api/v1/contacts', { name: 'Nuevo' }).expect(402);
    expect(blocked.body.code).toBe('ACCOUNT_READ_ONLY');
    await team.seller.api.patch(`/api/v1/contacts/${contactId}`, { name: 'Cambio' }).expect(402);
    await team.admin.api.del(`/api/v1/contacts/${contactId}`).expect(402);
    await team.owner.agent.get('/api/v1/exports/contacts.csv').expect(200);
  });

  it('en solo lectura se puede pagar; al activarse el plan vuelve a funcionar todo', async () => {
    const { team } = await expiredTeam('Reactiva SAS');
    await team.owner.api.put('/api/v1/billing/payment-method', { token: 'tok_test_1', acceptanceToken: 'a', acceptPersonalAuth: 'p', brand: 'VISA', lastFour: '4242' }).expect(200);
    t.wompi.nextStatus('APPROVED');
    await team.owner.api.post('/api/v1/billing/subscribe', { plan: 'basic' }).expect(202);
    expect((await team.owner.api.get('/api/v1/plan').expect(200)).body.status).toBe('active');
    await team.owner.api.post('/api/v1/contacts', { name: 'Ya pagó' }).expect(201);
  });

  it('el barrido marca las pruebas vencidas y avisa al propietario una sola vez', async () => {
    const { team } = await expiredTeam('Barrido SAS');
    await billing.expireTrials();
    await billing.expireTrials();
    const { rows } = await t.owner.query(`SELECT s.status FROM subscriptions s JOIN member m ON m."organizationId" = s.tenant_id JOIN "user" u ON u.id = m."userId" WHERE u.email = $1`, [team.owner.email]);
    expect(rows[0].status).toBe('read_only');
    expect(t.mailer.sent.filter((m) => m.to === team.owner.email && /prueba terminó/i.test(m.subject))).toHaveLength(1);
  });

  it('un pago atrasado (en reintento) todavía no bloquea', async () => {
    const team = await createTeam(t, 'Atrasada SAS');
    await t.owner.query(`UPDATE subscriptions s SET status = 'past_due' FROM member m JOIN "user" u ON u.id = m."userId"
      WHERE m."organizationId" = s.tenant_id AND u.email = $1`, [team.owner.email]);
    await team.owner.api.post('/api/v1/contacts', { name: 'Sigue trabajando' }).expect(201);
  });
});
