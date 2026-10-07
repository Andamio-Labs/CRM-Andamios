const OPT_OUT = new Set(['baja', 'stop', 'cancelar', 'no mas', 'no mas mensajes', 'desuscribir', 'parar']);
const OPT_IN = new Set(['alta', 'start', 'suscribir']);

/**
 * E04-S09 — El mensaje COMPLETO debe ser la palabra clave (sin tildes, mayúsculas ni puntuación).
 * "¿me das de baja el pedido?" NO es una baja: preferimos un falso negativo a silenciar a un cliente.
 */
export function consentKeyword(text: string | null): 'opt_out' | 'opt_in' | null {
  const normalized = (text ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
  if (OPT_OUT.has(normalized)) return 'opt_out';
  if (OPT_IN.has(normalized)) return 'opt_in';
  return null;
}
