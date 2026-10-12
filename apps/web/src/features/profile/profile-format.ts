import type { BadgeTone } from '../../shared/ui/section';

export function splitName(name: string) {
  const [first = '', ...rest] = name.trim().split(/\s+/);
  return { first, last: rest.join(' ') };
}

export function shortId(id: string) {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

const EVENT_LABELS: Record<string, string> = {
  created: 'Creaste el negocio',
  stage_changed: 'Moviste el negocio de etapa',
  won: 'Marcaste el negocio como ganado',
  lost: 'Marcaste el negocio como perdido',
  reopened: 'Reabriste el negocio',
};

export function eventLabel(type: string) {
  return EVENT_LABELS[type] ?? 'Actualizaste el negocio';
}

/** "hoy, 10:35 a. m." / "ayer, …" / "5/10/2026, …" con el día cortado en la zona de la empresa. */
export function whenLabel(iso: string, now: Date, timeZone: string, fmt: { date: (v: string) => string; time: (v: string) => string }) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const key = day.format(new Date(iso));
  const prefix = key === day.format(now) ? 'hoy' : key === day.format(new Date(now.getTime() - 86_400_000)) ? 'ayer' : fmt.date(iso);
  return `${prefix}, ${fmt.time(iso)}`;
}

export const REQUEST_STATUS: Record<'pending' | 'approved' | 'rejected' | 'canceled', { label: string; tone: BadgeTone }> = {
  pending: { label: 'Pendiente', tone: 'honey' },
  approved: { label: 'Aprobada', tone: 'success' },
  rejected: { label: 'Rechazada', tone: 'danger' },
  canceled: { label: 'Cancelada', tone: 'neutral' },
};
