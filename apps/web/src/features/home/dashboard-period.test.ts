import { describe, expect, it } from 'vitest';
import { firstName, periodRange } from './dashboard-period';

describe('periodo del dashboard', () => {
  // 9 de noviembre, 1:00 a. m. UTC = 8 de noviembre, 8:00 p. m. en Bogotá.
  const now = new Date('2026-11-09T01:00:00Z');

  it('cuenta los días en la zona de la empresa, hoy incluido', () => {
    expect(periodRange('7d', 'America/Bogota', now)).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(periodRange('30d', 'America/Bogota', now)).toEqual({ from: '2026-10-10', to: '2026-11-08' });
    expect(periodRange('7d', 'Europe/Madrid', now)).toEqual({ from: '2026-11-03', to: '2026-11-09' });
  });

  it('saluda con el primer nombre', () => {
    expect(firstName('Santiago Santofimio')).toBe('Santiago');
    expect(firstName(undefined)).toBe('');
  });
});
