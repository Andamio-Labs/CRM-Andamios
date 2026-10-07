type Range = { from: string; to: string };
type Week = Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', Range[]>;

const DAY_KEYS: Record<string, keyof Week> = { Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun' };

/**
 * E04-S10 — ¿Está abierto el negocio en `at`? Se evalúa en la zona horaria del TENANT
 * (no del servidor ni del cliente). [from, to): la hora de cierre ya es fuera de horario.
 */
export function isWithinBusinessHours(hours: Week, timeZone: string, at = new Date()): boolean {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at).map((p) => [p.type, p.value]),
  );
  const day = DAY_KEYS[parts.weekday ?? ''];
  if (!day) return false;
  const now = `${parts.hour}:${parts.minute}`;
  return hours[day].some((r) => r.from <= now && now < r.to);
}
