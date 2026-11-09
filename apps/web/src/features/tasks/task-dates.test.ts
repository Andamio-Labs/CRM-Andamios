import { describe, expect, it } from 'vitest';
import { duePresets, groupByWeek, groupMyTasks, weekOf } from './task-dates';

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

describe('Mis tareas y calendario (E06-S04)', () => {
  const task = (id: string, dueAt: string | null, status = 'open') => ({ id, dueAt, status });

  it('agrupa en atrasadas, hoy, próximas y sin fecha; las hechas no cuentan', () => {
    const groups = groupMyTasks([
      task('a', '2026-10-06T14:00:00Z'), // 9:00 de hoy en Bogotá, ya pasó
      task('b', '2026-10-06T22:00:00Z'), // 17:00 de hoy
      task('c', '2026-10-07T15:00:00Z'), // mañana
      task('d', null),
      task('e', '2026-10-06T22:00:00Z', 'done'),
    ], now, tz);
    expect(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.map((t) => t.id)]))).toEqual({ overdue: ['a'], today: ['b'], upcoming: ['c'], someday: ['d'] });
  });

  it('la semana va de lunes a domingo en la zona de la empresa', () => {
    const week = weekOf(now, tz);
    expect(week.start.toISOString()).toBe('2026-10-05T05:00:00.000Z'); // lunes 5, 00:00 en Bogotá
    expect(week.days).toHaveLength(7);
    expect(week.end.toISOString()).toBe('2026-10-12T05:00:00.000Z');
    expect(weekOf(now, tz, 1).start.toISOString()).toBe('2026-10-12T05:00:00.000Z');
  });
});
