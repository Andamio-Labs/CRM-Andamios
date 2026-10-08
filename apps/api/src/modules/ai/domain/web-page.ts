const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', iexcl: '¡', iquest: '¿', euro: '€',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü', ccedil: 'ç', atilde: 'ã', otilde: 'õ',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü', Ccedil: 'Ç', Atilde: 'Ã', Otilde: 'Õ',
};

const decode = (text: string) => text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
  if (entity[0] === '#') {
    const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
  }
  return NAMED[entity] ?? match;
});

const BLOCKS = 'p|div|h[1-6]|li|ul|ol|section|article|main|aside|blockquote|tr|table|dd|dt|pre';

/** E05-S02 — Texto legible de una página para la base de conocimiento: sin código, menús ni pie. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(head|title|script|style|noscript|nav|footer|svg|template|iframe|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(new RegExp(`</?(${BLOCKS})\\b[^>]*>`, 'gi'), '\n\n')
    .replace(/<[^>]+>/g, ' ');
  const text = decode(body)
    .split(/\n\s*\n/)
    .map((block) => block.replace(/[ \t\r\f\v ]+/g, ' ').replace(/ *\n */g, '\n').trim())
    .filter(Boolean)
    .join('\n\n');
  return { title, text };
}
