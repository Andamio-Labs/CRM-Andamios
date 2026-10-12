import type { PresenceStatus } from '../../../shared/database/schema.js';

export const PRESENCE_STATUSES = ['online', 'visit', 'dnd', 'offline'] as const satisfies readonly PresenceStatus[];
export const PRESENCE_DURATIONS = ['until_changed', '1h', 'end_of_day'] as const;
export type PresenceDuration = (typeof PRESENCE_DURATIONS)[number];

export interface StoredPresence {
  status: PresenceStatus;
  until: Date | null;
}

/**
 * E01-S09 — Estado que ve el equipo: lo elegido mientras no venza (al vencer vuelve a "en línea").
 * Sin ninguna sesión abierta (cerró sesión), desconectado.
 */
export function effectivePresence(stored: StoredPresence | undefined, hasSession: boolean, now: Date): PresenceStatus {
  if (!hasSession) return 'offline';
  if (!stored || (stored.until && stored.until <= now)) return 'online';
  return stored.status;
}

/** Asignación consciente: con no molestar o desconectado no le llegan leads nuevos. */
export const takesNewLeads = (status: PresenceStatus) => status === 'online' || status === 'visit';

/**
 * No molestar o desconectado ELEGIDOS a mano: los avisos esperan en la campana, sin push ni correo.
 * Cerrar sesión no cuenta: push y correo son justamente lo que avisa a quien no está en la app.
 */
export function mutesAlerts(stored: StoredPresence | undefined, now: Date): boolean {
  if (!stored || (stored.until && stored.until <= now)) return false;
  return stored.status === 'dnd' || stored.status === 'offline';
}
