export const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * E04-S04 — Ventana de atención al cliente de WhatsApp: 24 h desde el ÚLTIMO mensaje
 * del cliente. Cerrada, solo se permiten plantillas aprobadas.
 */
export function windowState(lastInboundAt: Date | null, now = new Date()) {
  if (!lastInboundAt) return { open: false, closesAt: null, remainingMs: 0 };
  const closesAt = new Date(lastInboundAt.getTime() + WINDOW_MS);
  const remainingMs = Math.max(0, closesAt.getTime() - now.getTime());
  return { open: remainingMs > 0, closesAt, remainingMs };
}
