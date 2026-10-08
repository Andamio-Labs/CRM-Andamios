import { createHash } from 'node:crypto';

/** Reintentos de un cobro rechazado: días después del rechazo, por número de intento fallido. */
const RETRY_DAYS = [1, 3, 5];
export const MAX_FAILED_ATTEMPTS = RETRY_DAYS.length + 1;

/** Un mes calendario después; si el día no existe (31 → febrero), el último día del mes. */
export function addBillingMonth(from: Date): Date {
  const next = new Date(from);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(from.getUTCDate(), lastDay));
  return next;
}

/** Cuándo reintentar después del intento fallido número `failedAttempts`; null si ya no hay más. */
export function nextRetryAt(failedAttempts: number, failedAt: Date): Date | null {
  const days = RETRY_DAYS[failedAttempts - 1];
  return days === undefined ? null : new Date(failedAt.getTime() + days * 86_400_000);
}

/**
 * Referencia única del cobro. Determinística por empresa, inicio de período e intento:
 * si el barrido corre dos veces, choca contra el UNIQUE y no se cobra dos veces.
 */
export function chargeReference(tenantId: string, periodStart: Date, attempt: number): string {
  return `bee-${createHash('sha256').update(`${tenantId}|${periodStart.toISOString()}|${attempt}`).digest('hex').slice(0, 24)}`;
}

export type ChargeOutcome = 'approved' | 'declined' | 'pending';

export function outcomeOf(wompiStatus: string): ChargeOutcome {
  if (wompiStatus === 'APPROVED') return 'approved';
  if (wompiStatus === 'PENDING') return 'pending';
  return 'declined'; // DECLINED, ERROR, VOIDED
}
