/** Separador de día en la conversación: "Hoy", "Ayer" o la fecha. `date` formatea en la zona de la empresa. */
export function dayLabel(at: string, date: (value: Date | string) => string, now = new Date()): string {
  const day = date(at);
  if (day === date(now)) return 'Hoy';
  if (day === date(new Date(now.getTime() - 86_400_000))) return 'Ayer';
  return day;
}

/** Corta el texto en partes; las URL http(s) quedan como enlace. Nunca `javascript:` ni otros esquemas. */
export function linkify(text: string): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = [];
  const pattern = /https?:\/\/[^\s<>"']+/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const url = match[0].replace(/[.,;:!?)]+$/, '');
    const start = match.index!;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: url, href: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
