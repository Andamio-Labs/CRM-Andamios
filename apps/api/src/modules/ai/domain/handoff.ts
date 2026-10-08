import { isWithinBusinessHours } from '../../whatsapp/domain/business-hours.js';
import type { AGENT_SCHEDULES } from './agent-prompt.js';
import { fold } from './guardrails.js';

export const DEFAULT_HANDOFF_KEYWORDS = ['asesor', 'humano', 'persona', 'agente'];
/** Una persona respondió: la IA se calla en esa conversación por este tiempo (E05-S05). */
export const HUMAN_REPLY_PAUSE_HOURS = 24;
/** Pausa sin vencimiento (traspaso o pausa manual). Fecha centinela: 'infinity' llega del driver como fecha inválida. */
export const INDEFINITE_PAUSE = new Date('9999-12-31T00:00:00Z');

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** E05-S05 — El cliente pide una persona. Palabra completa: "asesora de compras" no escala por "asesor". */
export function wantsHuman(text: string, keywords: readonly string[]): boolean {
  const folded = fold(text);
  return keywords.some((k) => k.trim() && new RegExp(`(^|[^\\p{L}])${escape(fold(k.trim()))}($|[^\\p{L}])`, 'u').test(folded));
}

export function isAiPaused(pausedUntil: Date | null, now = new Date()): boolean {
  return pausedUntil !== null && pausedUntil.getTime() > now.getTime();
}

/** E05-S01 — Horario del agente, en la zona horaria de la empresa. */
export function agentOnDuty(
  schedule: (typeof AGENT_SCHEDULES)[number],
  businessHours: Parameters<typeof isWithinBusinessHours>[0],
  timeZone: string,
  at: Date,
): boolean {
  if (schedule === 'always') return true;
  const open = isWithinBusinessHours(businessHours, timeZone, at);
  return schedule === 'business_hours' ? open : !open;
}
