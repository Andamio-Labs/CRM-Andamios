export interface ConversationWindow {
  open: boolean;
  closesAt: string | null;
}

/** E04-S04 — Texto del indicador de la ventana de 24 h. Se recalcula cada minuto en la UI. */
export function windowLabel(window: ConversationWindow, now = new Date()): { tone: 'open' | 'closing' | 'closed'; text: string } {
  const remaining = window.closesAt ? new Date(window.closesAt).getTime() - now.getTime() : 0;
  if (!window.open || remaining <= 0) return { tone: 'closed', text: 'Ventana cerrada: solo puedes enviar plantillas aprobadas' };

  const totalMinutes = Math.floor(remaining / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const left = totalMinutes < 1 ? 'queda menos de 1 min' : `quedan ${[hours && `${hours} h`, minutes && `${minutes} min`].filter(Boolean).join(' ')}`;
  return { tone: totalMinutes < 60 ? 'closing' : 'open', text: `Ventana abierta: ${left}` };
}
