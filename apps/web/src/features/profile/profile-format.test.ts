import { describe, expect, it } from 'vitest';
import { eventLabel, REQUEST_STATUS, shortId, splitName, whenLabel } from './profile-format';

describe('Formato del perfil', () => {
  it('separa nombre y apellido en el primer espacio', () => {
    expect(splitName('Santiago Fajardo Morales')).toEqual({ first: 'Santiago', last: 'Fajardo Morales' });
    expect(splitName('Ana')).toEqual({ first: 'Ana', last: '' });
  });

  it('acorta el id para mostrarlo', () => {
    expect(shortId('9befbc6e1234abcd')).toBe('9befbc6e…');
    expect(shortId('abc')).toBe('abc');
  });

  it('describe cada acción sobre un negocio', () => {
    expect(eventLabel('created')).toBe('Creaste el negocio');
    expect(eventLabel('stage_changed')).toBe('Moviste el negocio de etapa');
    expect(eventLabel('won')).toBe('Marcaste el negocio como ganado');
    expect(eventLabel('lost')).toBe('Marcaste el negocio como perdido');
    expect(eventLabel('otro')).toBe('Actualizaste el negocio');
  });

  it('dice hoy, ayer o la fecha, con la hora, en la zona de la empresa', () => {
    const now = new Date('2026-10-09T15:00:00Z');
    const fmt = { date: () => '5/10/2026', time: () => '10:35 a. m.' };
    expect(whenLabel('2026-10-09T14:00:00Z', now, 'America/Bogota', fmt)).toBe('hoy, 10:35 a. m.');
    expect(whenLabel('2026-10-09T02:00:00Z', now, 'America/Bogota', fmt)).toBe('ayer, 10:35 a. m.');
    expect(whenLabel('2026-10-05T14:00:00Z', now, 'America/Bogota', fmt)).toBe('5/10/2026, 10:35 a. m.');
  });

  it('tiene etiqueta y tono para cada estado de solicitud', () => {
    expect(Object.keys(REQUEST_STATUS)).toEqual(['pending', 'approved', 'rejected', 'canceled']);
    expect(REQUEST_STATUS.pending.label).toBe('Pendiente');
  });
});
