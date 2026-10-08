import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type pg from 'pg';
import { z } from 'zod';
import type { Env } from '../../../config/env.js';
import type { Database } from '../../../shared/database/database.js';
import { auditLog, billingCharges, subscriptions } from '../../../shared/database/schema.js';
import { withTenant } from '../../../shared/database/with-tenant.js';
import { AppError } from '../../../shared/http/app-error.js';
import { DB, ENV, PG_POOL, WOMPI_API } from '../../../shared/tokens.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { NotificationsService } from '../../tasks/notifications.service.js';
import { PAID_PLANS, type PaidPlanId, PLANS } from '../domain/plans.js';
import { addBillingMonth, chargeReference, type ChargeOutcome, nextRetryAt, outcomeOf } from '../domain/subscription.js';
import { integritySignature, verifyEventChecksum } from '../domain/wompi-signature.js';
import type { WompiApi } from '../infrastructure/wompi-api.js';

export const paymentMethodSchema = z.object({
  token: z.string().trim().min(1).max(200),
  acceptanceToken: z.string().trim().min(1).max(4000),
  acceptPersonalAuth: z.string().trim().min(1).max(4000),
  brand: z.string().trim().min(1).max(30),
  lastFour: z.string().regex(/^\d{4}$/),
}).strict();
export const subscribeSchema = z.object({ plan: z.enum(PAID_PLANS.map((p) => p.id) as [PaidPlanId, ...PaidPlanId[]]) }).strict();

type Charge = typeof billingCharges.$inferSelect;
interface ChargeSpec { kind: Charge['kind']; plan: PaidPlanId; attempt: number; periodStart: Date }

const conflict = (code: string, message: string) => new AppError(HttpStatus.CONFLICT, code, message);
const money = (cents: number) => `$${(cents / 100).toLocaleString('es-CO')} COP`;

/**
 * E10-S03 — Suscripción recurrente en COP con Wompi.
 * Cobro → (respuesta inmediata o webhook) → `apply()`, que es idempotente: solo actúa sobre cobros pendientes.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PG_POOL) private readonly conn: { pool: pg.Pool },
    @Inject(ENV) private readonly env: Env,
    @Inject(WOMPI_API) private readonly wompi: WompiApi,
    private readonly notifications: NotificationsService,
  ) {}

  account(auth: AuthContext) {
    return withTenant(this.db, auth.tenantId, async (tx) => {
      const [sub] = await tx.select().from(subscriptions);
      const charges = await tx.select().from(billingCharges).orderBy(desc(billingCharges.createdAt)).limit(24);
      return {
        plan: sub!.plan,
        status: sub!.status,
        trialEndsAt: sub!.trialEndsAt,
        currentPeriodEnd: sub!.currentPeriodEnd,
        failedAttempts: sub!.failedAttempts,
        nextRetryAt: sub!.nextRetryAt,
        card: sub!.paymentSourceId ? { brand: sub!.cardBrand, lastFour: sub!.cardLast4 } : null,
        plans: PAID_PLANS,
        payments: charges.map(({ tenantId: _t, wompiTransactionId: _w, ...c }) => c),
      };
    });
  }

  /** Lo que el navegador necesita para tokenizar la tarjeta y mostrar los documentos que acepta. */
  async checkout() {
    return { publicKey: this.env.WOMPI_PUBLIC_KEY, wompiUrl: this.env.WOMPI_URL, simulated: this.env.WOMPI_API === 'local', ...(await this.wompi.getAcceptance()) };
  }

  async setPaymentMethod(auth: AuthContext, input: z.infer<typeof paymentMethodSchema>) {
    const source = await this.wompi.createPaymentSource({
      token: input.token, customerEmail: await this.ownerEmail(auth.tenantId), acceptanceToken: input.acceptanceToken, acceptPersonalAuth: input.acceptPersonalAuth,
    }).catch((error: Error) => {
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'PAYMENT_METHOD_REJECTED', `Wompi no aceptó la tarjeta: ${error.message}`);
    });
    await withTenant(this.db, auth.tenantId, async (tx) => {
      await tx.update(subscriptions).set({ paymentSourceId: source.id, cardBrand: input.brand, cardLast4: input.lastFour });
      await tx.insert(auditLog).values({ tenantId: auth.tenantId, actorId: auth.userId, action: 'payment_method', entity: 'subscription', data: { brand: input.brand, lastFour: input.lastFour } });
    });
    return this.account(auth);
  }

  async subscribe(auth: AuthContext, { plan }: z.infer<typeof subscribeSchema>) {
    const [sub] = await withTenant(this.db, auth.tenantId, (tx) => tx.select().from(subscriptions));
    if (!sub!.paymentSourceId) throw conflict('PAYMENT_METHOD_REQUIRED', 'Agrega una tarjeta antes de suscribirte');
    if (sub!.status === 'active') {
      throw sub!.plan === plan
        ? conflict('ALREADY_SUBSCRIBED', 'Ya tienes este plan activo')
        : conflict('PLAN_CHANGE_NOT_AVAILABLE', 'El cambio de plan todavía no está disponible; escribinos y lo hacemos por vos');
    }
    if (sub!.status === 'past_due') throw conflict('PAST_DUE', 'Tu pago está en reintento automático. Si cambiaste la tarjeta, lo cobramos en el próximo intento.');
    const charge = await this.charge(auth.tenantId, { kind: 'subscribe', plan, attempt: 1, periodStart: new Date() });
    if (!charge) throw conflict('CHARGE_IN_PROGRESS', 'Ya hay un cobro en curso; espera su resultado');
    return { id: charge.id, reference: charge.reference, plan: charge.plan, amountInCents: charge.amountInCents, status: charge.status };
  }

  /** Webhook de Wompi. Firma inválida → 401 (Wompi reintenta); todo lo demás → 200, aunque se ignore. */
  async handleEvent(event: unknown) {
    if (!verifyEventChecksum(event, this.env.WOMPI_EVENTS_SECRET)) throw new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_SIGNATURE', 'Firma inválida');
    const { event: type, data } = event as { event: string; data: { transaction?: { id: string; status: string; reference: string; amount_in_cents: number; status_message?: string } } };
    const tx = data.transaction;
    if (type !== 'transaction.updated' || !tx?.reference) return;

    const { rows } = await this.conn.pool.query<{ tenant_id: string | null }>('SELECT billing_charge_route($1) AS tenant_id', [tx.reference]);
    const tenantId = rows[0]?.tenant_id;
    if (!tenantId) return;
    const [charge] = await withTenant(this.db, tenantId, (t) => t.select().from(billingCharges).where(eq(billingCharges.reference, tx.reference)));
    if (!charge || charge.amountInCents !== tx.amount_in_cents || (charge.wompiTransactionId && charge.wompiTransactionId !== tx.id)) {
      this.logger.warn(`Evento de Wompi que no coincide con el cobro ${tx.reference}: se ignora`);
      return;
    }
    await this.apply(tenantId, charge.id, outcomeOf(tx.status), { transactionId: tx.id, reason: tx.status_message ?? tx.status });
  }

  /** Barrido periódico: renueva períodos vencidos y ejecuta los reintentos que ya tocan. */
  async chargeDueSubscriptions(now = new Date()) {
    const { rows } = await this.conn.pool.query<{ tenant_id: string }>('SELECT tenant_id FROM billing_due_subscriptions($1)', [now]);
    for (const { tenant_id: tenantId } of rows) {
      const [sub] = await withTenant(this.db, tenantId, (tx) => tx.select().from(subscriptions));
      if (!sub || !(sub.plan in PLANS) || sub.plan === 'trial' || !sub.currentPeriodEnd) continue;
      await this.charge(tenantId, { kind: 'renewal', plan: sub.plan as PaidPlanId, attempt: sub.failedAttempts + 1, periodStart: sub.currentPeriodEnd }, now)
        .catch((error: Error) => this.logger.error(`Renovación de ${tenantId} falló: ${error.message}`));
    }
  }

  /** E10-S02 — Barrido de pruebas vencidas: pasan a solo lectura (sin borrar nada) y se avisa una vez. */
  async expireTrials(now = new Date()) {
    const { rows } = await this.conn.pool.query<{ tenant_id: string }>('SELECT tenant_id FROM expired_trials($1)', [now]);
    for (const { tenant_id: tenantId } of rows) {
      const [changed] = await withTenant(this.db, tenantId, (tx) => tx.update(subscriptions).set({ status: 'read_only' })
        .where(eq(subscriptions.status, 'trialing')).returning());
      if (!changed) continue;
      await this.notifications.notify(tenantId, await this.ownerIds(tenantId), {
        type: 'billing', title: 'Tu prueba terminó', link: '/settings?tab=plan', email: true,
        body: 'Tu cuenta quedó en solo lectura: puedes ver y exportar todo, pero no modificar. Activa un plan para seguir trabajando; tus datos están intactos.',
      });
    }
  }

  /** Crea el cobro (o nada, si ya existe o hay otro pendiente), llama a Wompi y aplica la respuesta inmediata. */
  private async charge(tenantId: string, spec: ChargeSpec, now = new Date()): Promise<Charge | null> {
    const amountInCents = PLANS[spec.plan].priceCop * 100;
    const reference = chargeReference(tenantId, spec.periodStart, spec.attempt);
    const [created] = await withTenant(this.db, tenantId, (tx) => tx.insert(billingCharges).values({
      tenantId, reference, kind: spec.kind, plan: spec.plan, amountInCents, attempt: spec.attempt,
      periodStart: spec.periodStart, periodEnd: addBillingMonth(spec.periodStart),
    }).onConflictDoNothing().returning());
    if (!created) return null;

    const [sub] = await withTenant(this.db, tenantId, (tx) => tx.select().from(subscriptions));
    try {
      const res = await this.wompi.createTransaction({
        amount_in_cents: amountInCents, currency: 'COP', customer_email: await this.ownerEmail(tenantId),
        payment_method: { installments: 1 }, payment_source_id: Number(sub!.paymentSourceId), reference,
        signature: integritySignature({ reference, amountInCents, currency: 'COP' }, this.env.WOMPI_INTEGRITY_SECRET), recurrent: true,
      });
      await withTenant(this.db, tenantId, (tx) => tx.update(billingCharges).set({ wompiTransactionId: res.id }).where(eq(billingCharges.id, created.id)));
      return await this.apply(tenantId, created.id, outcomeOf(res.status), { transactionId: res.id, reason: res.statusMessage ?? res.status }, now);
    } catch (error) {
      this.logger.error(`Cobro ${reference}: ${(error as Error).message}`);
      return this.apply(tenantId, created.id, 'declined', { reason: 'No pudimos comunicarnos con Wompi' }, now);
    }
  }

  /** Idempotente: solo un cobro pendiente cambia de estado; repetir el evento no hace nada. */
  private async apply(tenantId: string, chargeId: string, outcome: ChargeOutcome, info: { transactionId?: string; reason: string }, now = new Date()) {
    if (outcome === 'pending') return (await withTenant(this.db, tenantId, (tx) => tx.select().from(billingCharges).where(eq(billingCharges.id, chargeId))))[0]!;
    const result = await withTenant(this.db, tenantId, async (tx) => {
      const [charge] = await tx.update(billingCharges)
        .set({ status: outcome, failureReason: outcome === 'declined' ? info.reason : null, updatedAt: now, ...(info.transactionId ? { wompiTransactionId: info.transactionId } : {}) })
        .where(and(eq(billingCharges.id, chargeId), eq(billingCharges.status, 'pending'))).returning();
      if (!charge) return null;

      if (outcome === 'approved') {
        await tx.update(subscriptions).set({ plan: charge.plan, status: 'active', currentPeriodEnd: charge.periodEnd, failedAttempts: 0, nextRetryAt: null });
        return { charge, notice: { title: 'Pago recibido', body: `Cobramos ${money(charge.amountInCents)} del plan ${PLANS[charge.plan as PaidPlanId].name}. Tu próximo cobro es el ${charge.periodEnd.toLocaleDateString('es-CO')}.` } };
      }
      if (charge.kind === 'subscribe') {
        return { charge, notice: { title: 'No pudimos cobrar tu suscripción', body: `Wompi rechazó el pago (${info.reason}). Tu cuenta sigue como estaba; revisa la tarjeta e intenta de nuevo.` } };
      }
      const retry = nextRetryAt(charge.attempt, now);
      await tx.update(subscriptions).set({ status: retry ? 'past_due' : 'read_only', failedAttempts: charge.attempt, nextRetryAt: retry });
      return {
        charge,
        notice: retry
          ? { title: 'No pudimos cobrar tu suscripción', body: `Wompi rechazó el pago (${info.reason}). Lo reintentamos el ${retry.toLocaleDateString('es-CO')}; si quieres, actualiza la tarjeta antes.` }
          : { title: 'Tu cuenta quedó en solo lectura', body: 'No pudimos cobrar la suscripción después de varios intentos. Tus datos están intactos: actualiza la tarjeta y suscríbete de nuevo para seguir trabajando.' },
      };
    });
    if (!result) return (await withTenant(this.db, tenantId, (tx) => tx.select().from(billingCharges).where(eq(billingCharges.id, chargeId))))[0]!;
    await this.notifications.notify(tenantId, await this.ownerIds(tenantId), { type: 'billing', ...result.notice, link: '/settings?tab=plan', email: true });
    return result.charge;
  }

  private async ownerIds(tenantId: string) {
    const { rows } = await this.conn.pool.query<{ id: string }>(`SELECT "userId" AS id FROM member WHERE "organizationId" = $1 AND role = 'owner'`, [tenantId]);
    return rows.map((r) => r.id);
  }

  private async ownerEmail(tenantId: string) {
    const { rows } = await this.conn.pool.query<{ email: string }>(
      `SELECT u.email FROM member m JOIN "user" u ON u.id = m."userId" WHERE m."organizationId" = $1 AND m.role = 'owner' ORDER BY m."createdAt" LIMIT 1`, [tenantId]);
    return rows[0]!.email;
  }
}
