import { describe, expect, it } from 'vitest';
import { duePresets, groupByWeek } from './task-dates';

const tz = 'America/Bogota';
// Martes 6 de octubre de 2026, 10:00 en Bogotá.
const now = new Date('2026-10-06T15:00:00Z');

describe('duePresets (plantillas rápidas de la referencia)', () => {
  it('en una hora, mañana a las 9, en una semana', () => {
    const p = duePresets(now, tz);
    expect(p.map((x) => x.label)).toEqual(['En una hora', 'Mañana 9:00', 'En una semana']);
    expect(p[0]!.date.toISOString()).toBe('2026-10-06T16:00:00.000Z');
    expect(p[1]!.date.toISOString()).toBe('2026-10-07T14:00:00.000Z'); // 9:00 Bogotá = 14:00 UTC
    expect(p[2]!.date.toISOString()).toBe('2026-10-13T15:00:00.000Z');
  });
});

describe('groupByWeek (tareas agrupadas como en la referencia)', () => {
  const task = (id: string, dueAt: string | null, status = 'open') => ({ id, dueAt, status });
  it('vencidas, esta semana, la próxima, después y sin fecha', () => {
    const groups = groupByWeek([
      task('a', '2026-10-05T15:00:00Z'), // lunes pasado → vencida
      task('b', '2026-10-08T15:00:00Z'), // jueves → esta semana
      task('c', '2026-10-13T15:00:00Z'), // martes siguiente → próxima semana
      task('d', '2026-11-20T15:00:00Z'),
      task('e', null),
      task('f', '2026-10-01T15:00:00Z', 'done'), // hecha: no cuenta como vencida
    ], now, tz);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Vencidas', ['a']],
      ['Esta semana', ['b', 'f']],
      ['Próxima semana', ['c']],
      ['Más adelante', ['d']],
      ['Sin fecha', ['e']],
    ]);
  });
  it('omite grupos vacíos', () => {
    expect(groupByWeek([task('x', null)], now, tz).map((g) => g.label)).toEqual(['Sin fecha']);
  });
});
