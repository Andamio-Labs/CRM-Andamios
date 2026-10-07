/**
 * E09-S01 — Enlace Click-to-WhatsApp. El código de referencia viaja en el texto prellenado:
 * es lo único que WhatsApp nos devuelve del clic, y con él atribuimos origen y campaña.
 */
export function buildWaUrl(phone: string, message: string, code: string): string {
  const digits = phone.replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(`${message} (ref: ${code})`)}`;
}

export function extractRefCode(text: string | null): string | null {
  return text?.match(/\(ref:\s*([a-z0-9]{6,12})\)/)?.[1] ?? null;
}
