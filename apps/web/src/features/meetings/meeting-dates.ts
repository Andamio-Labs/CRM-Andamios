/** Día calendario (AAAA-MM-DD) de un instante en la zona del tenant. */
export function dayKey(at: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}

/** Grilla del mes como en un calendario de pared: 6 semanas que empiezan el lunes. `month` va de 0 a 11. */
export function monthGrid(year: number, month: number) {
  const offset = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7; // lunes = 0
  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(Date.UTC(year, month, 1 - offset + i));
    return { key: day.toISOString().slice(0, 10), day: day.getUTCDate(), inMonth: day.getUTCMonth() === month };
  });
}

/** Rango a pedir para la grilla, con un día de margen a cada lado: la zona del tenant corre los bordes. */
export function gridRange(year: number, month: number) {
  const offset = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  return {
    from: new Date(Date.UTC(year, month, 1 - offset - 1)).toISOString(),
    to: new Date(Date.UTC(year, month, 1 - offset + 43)).toISOString(),
  };
}

export const isLive = (meeting: { startsAt: string; endsAt: string }, now = new Date()) =>
  Date.parse(meeting.startsAt) <= now.getTime() && now.getTime() < Date.parse(meeting.endsAt);

/** Valor para <input type="datetime-local"> en la hora del navegador. */
export const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** Próxima hora en punto: el valor por defecto al programar. */
export function nextFullHour(now = new Date()) {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

/** Correos separados por coma, punto y coma, espacio o salto de línea. */
export function parseEmails(text: string) {
  const items = [...new Set(text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
  return { valid: items.filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)), invalid: items.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) };
}
