const MB = 1024 * 1024;

/**
 * E04-S06 — Límites de tamaño (los de WhatsApp Cloud API) y qué se puede mostrar en línea.
 * Documentado en docs/whatsapp.md. Solo tipos que el navegador NO ejecuta se sirven en línea:
 * un SVG o HTML de un tercero podría correr scripts en nuestro dominio.
 */
const INLINE = new Set([
  'image/jpeg', 'image/png', 'image/webp',
  'audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/amr', 'audio/mp4',
  'video/mp4', 'video/3gpp',
  'application/pdf',
]);

export function mediaPolicy(mimeType: string): { maxBytes: number; inline: boolean } {
  const type = mimeType.split(';')[0]!.trim().toLowerCase();
  const maxBytes = type.startsWith('image/') ? 5 * MB : type.startsWith('audio/') || type.startsWith('video/') ? 16 * MB : 100 * MB;
  return { maxBytes, inline: INLINE.has(type) };
}
