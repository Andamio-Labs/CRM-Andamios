import { describe, expect, it } from 'vitest';
import { chunkFaq, chunkText } from './chunking.js';

describe('chunkText (E05-S02)', () => {
  it('un texto corto es un solo fragmento, sin espacios sobrantes', () => {
    expect(chunkText('  Vendemos andamios.\n\n\n  Entregamos en Bogotá.  ')).toEqual(['Vendemos andamios.\n\nEntregamos en Bogotá.']);
  });

  it('corta por párrafos sin pasar el máximo y sin partir palabras', () => {
    const paragraph = (n: number) => `Párrafo ${n}. ${'palabra '.repeat(60).trim()}.`;
    const chunks = chunkText(Array.from({ length: 10 }, (_, i) => paragraph(i)).join('\n\n'), { maxChars: 1000 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1000);
      expect(chunk.endsWith('palabra.')).toBe(true);
    }
    expect(chunks.join('\n\n')).toContain('Párrafo 9.');
  });

  it('un párrafo gigante se corta por oraciones y, si hace falta, por palabras', () => {
    const giant = Array.from({ length: 200 }, (_, i) => `Oración número ${i} sobre andamios.`).join(' ');
    const chunks = chunkText(giant, { maxChars: 500 });
    expect(chunks.every((c) => c.length <= 500)).toBe(true);
    expect(chunks[0]!.startsWith('Oración número 0')).toBe(true);
    const noSpaces = 'a'.repeat(1200);
    expect(chunkText(noSpaces, { maxChars: 500 }).every((c) => c.length <= 500)).toBe(true);
  });

  it('texto vacío no genera fragmentos', () => {
    expect(chunkText('   \n ')).toEqual([]);
  });
});

describe('chunkFaq (E05-S02)', () => {
  it('cada pregunta con su respuesta es un fragmento', () => {
    expect(chunkFaq([{ question: '¿Hacen envíos?', answer: 'Sí, a toda Colombia.' }, { question: '¿Horario?', answer: 'Lunes a viernes.' }])).toEqual([
      'Pregunta: ¿Hacen envíos?\nRespuesta: Sí, a toda Colombia.',
      'Pregunta: ¿Horario?\nRespuesta: Lunes a viernes.',
    ]);
  });
});
