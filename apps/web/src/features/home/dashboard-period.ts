export type Period = '7d' | '14d' | '30d' | '90d';
export const PERIODS: [Period, string][] = [['7d', '7 días'], ['14d', '14 días'], ['30d', 'Mes'], ['90d', '3 meses']];
const DAYS: Record<Period, number> = { '7d': 7, '14d': 14, '30d': 30, '90d': 90 };

/** Día AAAA-MM-DD en la zona de la empresa. */
const dayIn = (at: Date, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/**
 * Rango para /reports: los últimos N días contando hoy, en la zona de la empresa (los dos extremos se incluyen).
 */
export function periodRange(period: Period, timeZone: string, now = new Date()) {
  const to = dayIn(now, timeZone);
  const [y, m, d] = to.split('-').map(Number) as [number, number, number];
  const from = new Date(Date.UTC(y, m - 1, d - (DAYS[period] - 1))).toISOString().slice(0, 10);
  return { from, to };
}

/** "Hola, Santiago": solo el primer nombre. */
export const firstName = (name: string | undefined) => name?.trim().split(/\s+/)[0] ?? '';
