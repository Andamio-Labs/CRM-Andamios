export const REQUEST_TYPES = ['access', 'update', 'erase', 'export'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

/**
 * Ley 1581 de 2012: consultas (art. 14) en 10 días hábiles; reclamos de corrección o supresión
 * (art. 15) en 15. No descuenta festivos: el plazo calculado puede quedar un día antes del legal, nunca después.
 */
const BUSINESS_DAYS: Record<RequestType, number> = { access: 10, export: 10, update: 15, erase: 15 };

export function addBusinessDays(from: Date, days: number): Date {
  const date = new Date(from);
  let added = 0;
  while (added < days) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) added++;
  }
  return date;
}

export function legalDeadline(type: RequestType, from: Date): Date {
  return addBusinessDays(from, BUSINESS_DAYS[type]);
}
