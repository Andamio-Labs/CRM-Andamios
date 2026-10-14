import { describe, expect, it } from 'vitest';
import { dayKey, gridRange, isLive, monthGrid, parseEmails } from './meeting-dates';

describe('calendario de reuniones', () => {
  it('el día de una reunión es el de la zona del tenant, no el UTC', () => {
    // 22:00 del 8 de octubre en Bogotá = 03:00 UTC del 9.
    expect(dayKey('2026-10-09T03:00:00Z', 'America/Bogota')).toBe('2026-10-08');
    expect(dayKey('2026-10-09T03:00:00Z', 'Europe/Madrid')).toBe('2026-10-09');
  });

  it('la grilla de octubre de 2026 empieza el lunes 28 de septiembre y tiene 6 semanas', () => {
    const cells = monthGrid(2026, 9);
    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual({ key: '2026-09-28', day: 28, inMonth: false });
    expect(cells[3]).toEqual({ key: '2026-10-01', day: 1, inMonth: true });
    expect(cells[41]).toEqual({ key: '2026-11-08', day: 8, inMonth: false });
  });

  it('pide un día de margen a cada lado de la grilla', () => {
    expect(gridRange(2026, 9)).toEqual({ from: '2026-09-27T00:00:00.000Z', to: '2026-11-10T00:00:00.000Z' });
  });

  it('en curso entre el inicio y el fin', () => {
    const meeting = { startsAt: '2026-10-08T15:00:00Z', endsAt: '2026-10-08T16:00:00Z' };
    expect(isLive(meeting, new Date('2026-10-08T15:30:00Z'))).toBe(true);
    expect(isLive(meeting, new Date('2026-10-08T16:00:00Z'))).toBe(false);
  });

  it('separa los correos de invitados y avisa los que no sirven', () => {
    expect(parseEmails('ana@cliente.co, Pedro@Cliente.co;  mal-escrito\nana@cliente.co')).toEqual({
      valid: ['ana@cliente.co', 'pedro@cliente.co'],
      invalid: ['mal-escrito'],
    });
  });
});
