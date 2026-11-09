import { describe, expect, it } from 'vitest';
import { dayLabel, linkify } from './chat-format';

describe('chat del equipo', () => {
  const date = (value: Date | string) => new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota' }).format(new Date(value));
  const now = new Date('2026-11-09T15:00:00Z');

  it('separa los días como Hoy, Ayer o la fecha', () => {
    expect(dayLabel('2026-11-09T13:00:00Z', date, now)).toBe('Hoy');
    expect(dayLabel('2026-11-08T13:00:00Z', date, now)).toBe('Ayer');
    expect(dayLabel('2026-11-01T13:00:00Z', date, now)).toBe(date('2026-11-01T13:00:00Z'));
  });

  it('convierte en enlace solo las URL http(s), sin el punto final', () => {
    expect(linkify('Entra aquí: https://meet.jit.si/BeeCRM-abc. ¡Te espero!')).toEqual([
      { text: 'Entra aquí: ' },
      { text: 'https://meet.jit.si/BeeCRM-abc', href: 'https://meet.jit.si/BeeCRM-abc' },
      { text: '. ¡Te espero!' },
    ]);
    expect(linkify('javascript:alert(1) y ftp://x.co')).toEqual([{ text: 'javascript:alert(1) y ftp://x.co' }]);
  });
});
