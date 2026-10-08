import { describe, expect, it } from 'vitest';
import { addBusinessDays, legalDeadline } from './deadlines.js';

describe('Plazos de la Ley 1581 (E13-S03)', () => {
  it('suma días hábiles saltando sábados y domingos', () => {
    // Jueves 8-oct-2026 + 2 hábiles = lunes 12-oct
    expect(addBusinessDays(new Date('2026-10-08T15:00:00Z'), 2).toISOString().slice(0, 10)).toBe('2026-10-12');
    // Viernes + 1 = lunes
    expect(addBusinessDays(new Date('2026-10-09T15:00:00Z'), 1).toISOString().slice(0, 10)).toBe('2026-10-12');
    // Sábado + 1 = lunes
    expect(addBusinessDays(new Date('2026-10-10T15:00:00Z'), 1).toISOString().slice(0, 10)).toBe('2026-10-12');
  });

  it('consulta y exportación: 10 días hábiles; corrección y supresión (reclamos): 15', () => {
    const from = new Date('2026-10-08T15:00:00Z');
    expect(legalDeadline('access', from).toISOString().slice(0, 10)).toBe('2026-10-22');
    expect(legalDeadline('export', from).toISOString().slice(0, 10)).toBe('2026-10-22');
    expect(legalDeadline('update', from).toISOString().slice(0, 10)).toBe('2026-10-29');
    expect(legalDeadline('erase', from).toISOString().slice(0, 10)).toBe('2026-10-29');
  });
});
