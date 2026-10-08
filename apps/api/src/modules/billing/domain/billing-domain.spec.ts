import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { addBillingMonth, chargeReference, nextRetryAt, outcomeOf } from './subscription.js';
import { integritySignature, verifyEventChecksum } from './wompi-signature.js';
import { PAID_PLANS, planLimits } from './plans.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('Firmas de Wompi (E10-S03)', () => {
  it('integridad: SHA256 de referencia + monto en centavos + moneda + secreto, en ese orden (ejemplo de la doc)', () => {
    expect(integritySignature({ reference: 'sk8-438k4-xmxm392-sn2m2', amountInCents: 490000, currency: 'COP' }, 'test_integrity_ejemplo_no_real'))
      .toBe(sha('sk8-438k4-xmxm392-sn2m2490000COPtest_integrity_ejemplo_no_real'));
  });

  const event = (checksum: string) => ({
    event: 'transaction.updated',
    data: { transaction: { id: '1234-1610641025-49201', status: 'APPROVED', amount_in_cents: 4490000, reference: 'R1' } },
    signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum },
    timestamp: 1530291411,
  });
  const secret = 'test_events_ejemplo_no_real';
  const good = sha(`1234-1610641025-49201APPROVED44900001530291411${secret}`);

  it('evento: valores de signature.properties en orden + timestamp + secreto; acepta mayúsculas o minúsculas', () => {
    expect(verifyEventChecksum(event(good), secret)).toBe(true);
    expect(verifyEventChecksum(event(good.toUpperCase()), secret)).toBe(true);
  });

  it('evento: rechaza checksum alterado, secreto incorrecto o propiedades raras', () => {
    expect(verifyEventChecksum(event(good.replace(/^./, '0')), secret)).toBe(false);
    expect(verifyEventChecksum(event(good), 'otro')).toBe(false);
    expect(verifyEventChecksum({ ...event(good), signature: { properties: ['transaction.__proto__'], checksum: good } }, secret)).toBe(false);
    expect(verifyEventChecksum({ event: 'x' }, secret)).toBe(false);
  });
});

describe('Suscripción (E10-S03)', () => {
  it('el mes de facturación respeta fin de mes', () => {
    expect(addBillingMonth(new Date('2026-01-31T15:00:00Z')).toISOString()).toBe('2026-02-28T15:00:00.000Z');
    expect(addBillingMonth(new Date('2026-10-08T12:00:00Z')).toISOString()).toBe('2026-11-08T12:00:00.000Z');
  });

  it('reintentos a +1, +3 y +5 días del rechazo; después no hay más', () => {
    const at = new Date('2026-10-08T00:00:00Z');
    expect(nextRetryAt(1, at)?.toISOString()).toBe('2026-10-09T00:00:00.000Z');
    expect(nextRetryAt(2, at)?.toISOString()).toBe('2026-10-11T00:00:00.000Z');
    expect(nextRetryAt(3, at)?.toISOString()).toBe('2026-10-13T00:00:00.000Z');
    expect(nextRetryAt(4, at)).toBeNull();
  });

  it('la referencia es determinística por empresa, período e intento (evita cobrar dos veces)', () => {
    const a = chargeReference('tenant-abc', new Date('2026-11-08T12:00:00Z'), 1);
    expect(a).toBe(chargeReference('tenant-abc', new Date('2026-11-08T12:00:00Z'), 1));
    expect(a).not.toBe(chargeReference('tenant-abc', new Date('2026-11-08T12:00:00Z'), 2));
    expect(a).not.toBe(chargeReference('tenant-xyz', new Date('2026-11-08T12:00:00Z'), 1));
    expect(a).toMatch(/^bee-[a-z0-9-]+$/);
  });

  it('traduce los estados de Wompi', () => {
    expect(outcomeOf('APPROVED')).toBe('approved');
    expect(outcomeOf('DECLINED')).toBe('declined');
    expect(outcomeOf('ERROR')).toBe('declined');
    expect(outcomeOf('VOIDED')).toBe('declined');
    expect(outcomeOf('PENDING')).toBe('pending');
  });

  it('los planes pagos tienen precio en COP y límites mayores que el trial', () => {
    for (const plan of PAID_PLANS) {
      expect(plan.priceCop).toBeGreaterThan(0);
      expect(planLimits(plan.id).maxUsers).toBeGreaterThanOrEqual(planLimits('trial').maxUsers);
    }
  });
});
