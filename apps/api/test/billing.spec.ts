import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BillingService } from '../src/modules/billing/application/billing.service.js';
import { createTeam, createTestApp, type TestApp, WOMPI_EVENTS_SECRET } from './support/test-app.js';

/** E10-S03 — Suscripción recurrente en COP con Wompi. */
describe('Suscripción con Wompi (E10-S03)', () => {
  let t: TestApp;
  let billing: BillingService;

  beforeAll(async () => {
    t = await createTestApp();
    billing = t.app.get(BillingService);
  });
  beforeEach(() => t.wompi.reset());
  afterAll(() => t.close());

  /** Evento firmado como lo firma Wompi. */
  function wompiEvent(tx: { id: string; status: string; amount_in_cents: number; reference: string }, secret = WOMPI_EVENTS_SECRET) {
    const timestamp = Math.floor(Date.now() / 1000);
    const checksum = createHash('sha256').update(`${tx.id}${tx.status}${tx.amount_in_cents}${timestamp}${secret}`).digest('hex');
    return {
      event: 'transaction.updated',
      data: { transaction: { ...tx, currency: 'COP', customer_email: 'x@y.co', payment_method_type: 'CARD' } },
      environment: 'test',
      signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum },
      timestamp,
      sent_at: new Date().toISOString(),
    };
  }
  const sendEvent = (body: object) => t.http().post('/api/webhooks/wompi').send(body);

  async function teamWithCard(name: string) {
    const team = await createTeam(t, name);
    await team.owner.api.put('/api/v1/billing/payment-method', {
      token: 'tok_test_123', acceptanceToken: 'acc_local', acceptPersonalAuth: 'pda_local', brand: 'VISA', lastFour: '4242',
    }).expect(200);
    return team;
  }
  const subscription = async (team: Awaited<ReturnType<typeof createTeam>>) => (await team.owner.api.get('/api/v1/billing').expect(200)).body;

  describe('Estado de cuenta', () => {
    it('el propietario ve plan, estado, planes con precio en COP y que no hay tarjeta; nadie más', async () => {
      const team = await createTeam(t, 'Cuenta SAS');
      const res = (await team.owner.api.get('/api/v1/billing').expect(200)).body;
      expect(res).toMatchObject({ plan: 'trial', status: 'trialing', card: null, payments: [] });
      expect(res.trialEndsAt).toBeTruthy();
      expect(res.plans.map((p: { id: string }) => p.id)).toEqual(['basic', 'pro']);
      expect(res.plans[0].priceCop).toBeGreaterThan(0);
      await team.admin.api.get('/api/v1/billing').expect(403);
      await team.seller.api.get('/api/v1/billing').expect(403);
    });

    it('entrega la llave pública y los documentos de aceptación de Wompi', async () => {
      const team = await createTeam(t, 'Checkout SAS');
      const res = (await team.owner.api.get('/api/v1/billing/checkout').expect(200)).body;
      expect(res).toMatchObject({ publicKey: expect.stringMatching(/^pub_/), acceptanceToken: 'acc_local', personalDataAuthToken: 'pda_local' });
      expect(res.termsUrl).toMatch(/^https:/);
      expect(res).not.toHaveProperty('privateKey');
    });
  });

  describe('Medio de pago', () => {
    it('guarda la tarjeta tokenizada como fuente de pago en Wompi con las aceptaciones; queda en auditoría', async () => {
      const team = await teamWithCard('Tarjeta SAS');
      expect(t.wompi.sources.at(-1)).toMatchObject({ token: 'tok_test_123', customerEmail: team.owner.email, acceptanceToken: 'acc_local', acceptPersonalAuth: 'pda_local' });
      expect((await subscription(team)).card).toEqual({ brand: 'VISA', lastFour: '4242' });
      const { rows } = await t.owner.query(`SELECT 1 FROM audit_log a JOIN member m ON m."organizationId" = a.tenant_id JOIN "user" u ON u.id = m."userId"
        WHERE a.action = 'payment_method' AND u.email = $1`, [team.owner.email]);
      expect(rows).toHaveLength(1);
    });

    it('valida los datos y exige las dos aceptaciones', async () => {
      const team = await createTeam(t, 'Validación SAS');
      const put = (body: object) => team.owner.api.put('/api/v1/billing/payment-method', body);
      await put({ token: 'tok_x', acceptanceToken: 'acc', brand: 'VISA', lastFour: '4242' }).expect(400);
      await put({ token: 'tok_x', acceptanceToken: 'acc', acceptPersonalAuth: 'pda', brand: 'VISA', lastFour: '42' }).expect(400);
      await team.admin.api.put('/api/v1/billing/payment-method', { token: 'tok_x', acceptanceToken: 'a', acceptPersonalAuth: 'p', brand: 'VISA', lastFour: '4242' }).expect(403);
    });
  });

  describe('Suscribirse', () => {
    it('sin tarjeta no se puede; plan inexistente es 400', async () => {
      const team = await createTeam(t, 'Sin tarjeta SAS');
      expect((await team.owner.api.post('/api/v1/billing/subscribe', { plan: 'pro' }).expect(409)).body.code).toBe('PAYMENT_METHOD_REQUIRED');
      await team.owner.api.post('/api/v1/billing/subscribe', { plan: 'oro' }).expect(400);
    });

    it('cobra el primer mes firmado y recurrente; el webhook aprobado activa el plan y sus límites; reintentos de Wompi no duplican', async () => {
      const team = await teamWithCard('Suscrita SAS');
      t.wompi.nextStatus('PENDING');
      const pending = (await team.owner.api.post('/api/v1/billing/subscribe', { plan: 'pro' }).expect(202)).body;
      expect(pending).toMatchObject({ status: 'pending', plan: 'pro', amountInCents: 249_000_00 });

      const sent = t.wompi.transactions.at(-1)!;
      expect(sent).toMatchObject({ amount_in_cents: 249_000_00, currency: 'COP', customer_email: team.owner.email, recurrent: true, payment_method: { installments: 1 } });
      expect(sent.signature).toBe(createHash('sha256').update(`${sent.reference}${sent.amount_in_cents}COPtest_integrity_test`).digest('hex'));
      expect((await subscription(team)).plan).toBe('trial');

      const event = wompiEvent({ id: sent.id, status: 'APPROVED', amount_in_cents: sent.amount_in_cents, reference: sent.reference });
      await sendEvent(event).expect(200);
      let account = await subscription(team);
      expect(account).toMatchObject({ plan: 'pro', status: 'active' });
      const periodEnd = account.currentPeriodEnd;
      expect(Date.parse(periodEnd) - Date.now()).toBeGreaterThan(27 * 86_400_000);
      expect(account.payments[0]).toMatchObject({ status: 'approved', amountInCents: 249_000_00 });
      expect((await team.owner.api.get('/api/v1/plan').expect(200)).body.limits.maxUsers).toBe(10);
      expect(t.mailer.sent.findLast((m) => m.to === team.owner.email)?.subject).toMatch(/pago recibido/i);

      await sendEvent(event).expect(200);
      account = await subscription(team);
      expect(account.currentPeriodEnd).toBe(periodEnd);
      expect(account.payments).toHaveLength(1);
    });

    it('si Wompi aprueba en la respuesta, el plan se activa sin esperar el webhook', async () => {
      const team = await teamWithCard('Inmediata SAS');
      t.wompi.nextStatus('APPROVED');
      expect((await team.owner.api.post('/api/v1/billing/subscribe', { plan: 'basic' }).expect(202)).body.status).toBe('approved');
      expect(await subscription(team)).toMatchObject({ plan: 'basic', status: 'active' });
    });

    it('un primer cobro rechazado deja la prueba como estaba y avisa', async () => {
      const team = await teamWithCard('Rechazada SAS');
      t.wompi.nextStatus('DECLINED');
      expect((await team.owner.api.post('/api/v1/billing/subscribe', { plan: 'pro' }).expect(202)).body.status).toBe('declined');
      expect(await subscription(team)).toMatchObject({ plan: 'trial', status: 'trialing' });
      expect(t.mailer.sent.findLast((m) => m.to === team.owner.email)?.subject).toMatch(/no pudimos cobrar/i);
    });

    it('ya suscrito: el mismo plan es 409 y el cambio de plan llega con E10-S05', async () => {
      const team = await teamWithCard('Activa SAS');
      t.wompi.nextStatus('APPROVED');
      await team.owner.api.post('/api/v1/billing/subscribe', { plan: 'basic' }).expect(202);
      expect((await team.owner.api.post('/api/v1/billing/subscribe', { plan: 'basic' }).expect(409)).body.code).toBe('ALREADY_SUBSCRIBED');
      expect((await team.owner.api.post('/api/v1/billing/subscribe', { plan: 'pro' }).expect(409)).body.code).toBe('PLAN_CHANGE_NOT_AVAILABLE');
    });

    it('no deja dos cobros pendientes a la vez', async () => {
      const team = await teamWithCard('Doble clic SAS');
      t.wompi.nextStatus('PENDING');
      await team.owner.api.post('/api/v1/billing/subscribe', { plan: 'pro' }).expect(202);
      expect((await team.owner.api.post('/api/v1/billing/subscribe', { plan: 'pro' }).expect(409)).body.code).toBe('CHARGE_IN_PROGRESS');
      expect(t.wompi.transactions).toHaveLength(1);
    });
  });

  describe('Webhook', () => {
    it('rechaza firmas inválidas y montos que no coinciden', async () => {
      const team = await teamWithCard('Webhook SAS');
      t.wompi.nextStatus('PENDING');
      await team.owner.api.post('/api/v1/billing/subscribe', { plan: 'pro' }).expect(202);
      const sent = t.wompi.transactions.at(-1)!;
      await sendEvent(wompiEvent({ id: sent.id, status: 'APPROVED', amount_in_cents: sent.amount_in_cents, reference: sent.reference }, 'secreto-falso')).expect(401);
      await sendEvent(wompiEvent({ id: sent.id, status: 'APPROVED', amount_in_cents: 100, reference: sent.reference })).expect(200);
      expect((await subscription(team)).plan).toBe('trial');
    });

    it('una referencia desconocida o un evento de otro tipo se ignora con 200', async () => {
      await sendEvent(wompiEvent({ id: 'x-1', status: 'APPROVED', amount_in_cents: 100, reference: 'ajena-123' })).expect(200);
      await sendEvent({ ...wompiEvent({ id: 'x-2', status: 'APPROVED', amount_in_cents: 100, reference: 'r' }), event: 'nequi_token.updated' }).expect(200);
    });
  });

  describe('Renovación mensual y reintentos', () => {
    async function activeTeam(name: string) {
      const team = await teamWithCard(name);
      t.wompi.nextStatus('APPROVED');
      await team.owner.api.post('/api/v1/billing/subscribe', { plan: 'basic' }).expect(202);
      const end = new Date(Date.now() - 60_000);
      await t.owner.query(`UPDATE subscriptions s SET current_period_end = $2 FROM member m JOIN "user" u ON u.id = m."userId"
        WHERE m."organizationId" = s.tenant_id AND u.email = $1`, [team.owner.email, end]);
      return { team, end };
    }

    it('al vencer el período cobra el mes siguiente y lo extiende', async () => {
      const { team, end } = await activeTeam('Renueva SAS');
      t.wompi.nextStatus('APPROVED');
      await billing.chargeDueSubscriptions();
      const account = await subscription(team);
      expect(account).toMatchObject({ plan: 'basic', status: 'active' });
      expect(new Date(account.currentPeriodEnd).getUTCMonth()).toBe((end.getUTCMonth() + 1) % 12);
      expect(account.payments).toHaveLength(2);
      expect(t.wompi.transactions.at(-1)).toMatchObject({ recurrent: true, amount_in_cents: 99_000_00 });
    });

    it('rechazo: queda en mora con reintentos a +1, +3 y +5 días; al agotarlos pasa a solo lectura sin perder datos', async () => {
      const { team } = await activeTeam('Mora SAS');
      let now = new Date();
      const expected = [[1, 1], [2, 3], [3, 5]] as const;
      for (const [attempt, days] of expected) {
        t.wompi.nextStatus('DECLINED');
        await billing.chargeDueSubscriptions(now);
        const account = await subscription(team);
        expect(account).toMatchObject({ status: 'past_due', failedAttempts: attempt });
        expect(Math.round((Date.parse(account.nextRetryAt) - now.getTime()) / 86_400_000)).toBe(days);

        const before = t.wompi.transactions.length;
        await billing.chargeDueSubscriptions(now); // todavía no toca: no cobra
        expect(t.wompi.transactions).toHaveLength(before);
        now = new Date(Date.parse(account.nextRetryAt) + 1000);
      }
      t.wompi.nextStatus('DECLINED');
      await billing.chargeDueSubscriptions(now);
      expect(await subscription(team)).toMatchObject({ status: 'read_only', failedAttempts: 4, nextRetryAt: null });
      expect(t.mailer.sent.findLast((m) => m.to === team.owner.email)?.subject).toMatch(/solo lectura/i);
    });

    it('si un reintento se aprueba, vuelve a activa y se reinician los intentos', async () => {
      const { team } = await activeTeam('Recupera SAS');
      t.wompi.nextStatus('DECLINED');
      await billing.chargeDueSubscriptions();
      const { nextRetryAt } = await subscription(team);
      t.wompi.nextStatus('APPROVED');
      await billing.chargeDueSubscriptions(new Date(Date.parse(nextRetryAt) + 1000));
      expect(await subscription(team)).toMatchObject({ status: 'active', failedAttempts: 0, nextRetryAt: null });
    });

    it('si Wompi no responde cuenta como intento fallido y se reintenta después', async () => {
      const { team } = await activeTeam('Caída SAS');
      t.wompi.failNext();
      await billing.chargeDueSubscriptions();
      const account = await subscription(team);
      expect(account).toMatchObject({ status: 'past_due', failedAttempts: 1 });
      expect(account.payments[0]).toMatchObject({ status: 'declined', failureReason: expect.stringMatching(/Wompi/) });
    });

    it('dos barridos simultáneos cobran una sola vez', async () => {
      await activeTeam('Concurrente SAS');
      t.wompi.nextStatus('PENDING');
      const before = t.wompi.transactions.length;
      await Promise.all([billing.chargeDueSubscriptions(), billing.chargeDueSubscriptions()]);
      expect(t.wompi.transactions.length - before).toBe(1);
    });
  });
});
