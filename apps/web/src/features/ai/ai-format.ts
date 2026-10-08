import type { BadgeTone } from '../../shared/ui/section';

export type Outcome = 'replied' | 'handoff' | 'blocked' | 'error' | 'quota';
export type PauseReason = 'human_reply' | 'manual' | 'handoff' | 'guardrail';

export const OUTCOMES: Record<Outcome, { label: string; tone: BadgeTone }> = {
  replied: { label: 'Respondió', tone: 'success' },
  handoff: { label: 'Pasó a una persona', tone: 'honey' },
  blocked: { label: 'Frenada por seguridad', tone: 'danger' },
  error: { label: 'Error', tone: 'danger' },
  quota: { label: 'Sin cuota', tone: 'neutral' },
};

export const VIOLATIONS: Record<string, string> = {
  unverified_price: 'Precio que no está en la base',
  prompt_leak: 'Intentó revelar sus reglas',
  prompt_injection: 'Intento de manipulación',
};

export const PAUSE_REASONS: Record<PauseReason, string> = {
  human_reply: 'Respondió una persona',
  manual: 'Pausada a mano',
  handoff: 'Pasada a una persona',
  guardrail: 'Frenada por seguridad',
};

/** Costo en millonésimas de dólar → "US$ 0,0007". Con menos de un centavo se muestran 4 decimales. */
export function formatUsd(micros: number): string {
  const usd = micros / 1_000_000;
  const digits = usd !== 0 && usd < 0.01 ? 4 : 2;
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(usd);
}

/** El servidor guarda la pausa sin vencimiento como 9999-12-31 (ver migración 0012). */
const INDEFINITE_YEAR = 9999;

export function aiPauseState(
  conversation: { aiPausedUntil: string | null; aiPauseReason: PauseReason | null },
  now = new Date(),
): { paused: false } | { paused: true; reason: PauseReason; until: Date | null } {
  if (!conversation.aiPausedUntil) return { paused: false };
  const until = new Date(conversation.aiPausedUntil);
  if (until.getTime() <= now.getTime()) return { paused: false };
  return { paused: true, reason: conversation.aiPauseReason ?? 'manual', until: until.getUTCFullYear() >= INDEFINITE_YEAR ? null : until };
}
