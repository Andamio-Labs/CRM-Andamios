/** Offset (ms) de una zona horaria en un instante dado: lo que hay que sumar a UTC para ver la hora local. */
function offsetMs(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - at.getTime();
}

/** Medianoche (inicio del día) en la zona del tenant, `days` días después del día de `at`. */
function startOfDay(at: Date, timeZone: string, days = 0): Date {
  const local = new Date(at.getTime() + offsetMs(at, timeZone));
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + days);
  return new Date(midnightLocal - offsetMs(new Date(midnightLocal), timeZone));
}

/** E06-S02 — Plantillas rápidas de vencimiento vistas en la referencia. */
export function duePresets(now: Date, timeZone: string) {
  return [
    { label: 'En una hora', date: new Date(now.getTime() + 3_600_000) },
    { label: 'Mañana 9:00', date: new Date(startOfDay(now, timeZone, 1).getTime() + 9 * 3_600_000) },
    { label: 'En una semana', date: new Date(now.getTime() + 7 * 86_400_000) },
  ];
}

interface Dated { dueAt: string | null; status: string }

/** Agrupa como en la referencia; las semanas empiezan el lunes, en la zona del tenant. */
export function groupByWeek<T extends Dated>(items: T[], now: Date, timeZone: string) {
  const today = startOfDay(now, timeZone);
  const weekday = (new Date(today.getTime() + offsetMs(today, timeZone)).getUTCDay() + 6) % 7; // lunes = 0
  const nextWeek = startOfDay(today, timeZone, 7 - weekday);
  const weekAfter = startOfDay(nextWeek, timeZone, 7);
  const groups: { label: string; items: T[] }[] = [
    { label: 'Vencidas', items: [] }, { label: 'Esta semana', items: [] }, { label: 'Próxima semana', items: [] },
    { label: 'Más adelante', items: [] }, { label: 'Sin fecha', items: [] },
  ];
  for (const item of items) {
    const due = item.dueAt ? new Date(item.dueAt) : null;
    const index = !due ? 4 : item.status === 'open' && due < now ? 0 : due < nextWeek ? 1 : due < weekAfter ? 2 : 3;
    groups[index]!.items.push(item);
  }
  return groups.filter((g) => g.items.length);
}
