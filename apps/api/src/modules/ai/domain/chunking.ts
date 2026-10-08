/**
 * E05-S02 — Troceado de la base de conocimiento en fragmentos para la búsqueda vectorial (RAG).
 * Respeta párrafos y oraciones para que cada fragmento tenga sentido por sí solo.
 */
const DEFAULT_MAX_CHARS = 1200;

export function chunkText(text: string, { maxChars = DEFAULT_MAX_CHARS } = {}): string[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const piece of paragraphs.flatMap((p) => splitToFit(p, maxChars))) {
    const joined = current ? `${current}\n\n${piece}` : piece;
    if (joined.length <= maxChars) {
      current = joined;
    } else {
      chunks.push(current);
      current = piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function chunkFaq(items: readonly { question: string; answer: string }[]): string[] {
  return items.map(({ question, answer }) => `Pregunta: ${question.trim()}\nRespuesta: ${answer.trim()}`);
}

/** Un párrafo que no entra se parte por oraciones; una oración que no entra, por palabras; una palabra, a la fuerza. */
function splitToFit(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) return [paragraph];
  const sentences = paragraph.match(/[^.!?¡¿]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [paragraph];
  const out: string[] = [];
  let current = '';
  for (const raw of sentences) {
    const sentence = raw.trim();
    const pieces = sentence.length <= maxChars ? [sentence] : splitWords(sentence, maxChars);
    for (const piece of pieces) {
      const joined = current ? `${current} ${piece}` : piece;
      if (joined.length <= maxChars) {
        current = joined;
      } else {
        out.push(current);
        current = piece;
      }
    }
  }
  if (current) out.push(current);
  return out;
}

function splitWords(sentence: string, maxChars: number): string[] {
  const out: string[] = [];
  let current = '';
  for (const word of sentence.split(/\s+/)) {
    for (let i = 0; i < word.length; i += maxChars) {
      const part = word.slice(i, i + maxChars);
      const joined = current ? `${current} ${part}` : part;
      if (joined.length <= maxChars) {
        current = joined;
      } else {
        out.push(current);
        current = part;
      }
    }
  }
  if (current) out.push(current);
  return out;
}
