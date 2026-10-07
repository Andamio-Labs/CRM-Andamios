import { describe, expect, it } from 'vitest';
import { windowLabel } from './window';

/** E04-S04 — Indicador visible del tiempo restante de la ventana de 24 h. */
describe('windowLabel', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  it.each([
    ['2026-10-07T10:00:00Z', 'open', 'Ventana abierta: quedan 22 h'],
    ['2026-10-06T15:20:00Z', 'open', 'Ventana abierta: quedan 3 h 20 min'],
    ['2026-10-06T12:45:00Z', 'closing', 'Ventana abierta: quedan 45 min'],
    ['2026-10-06T12:00:30Z', 'closing', 'Ventana abierta: queda menos de 1 min'],
  ])('cierra %s → %s: %s', (closesAt, tone, label) => {
    expect(windowLabel({ open: true, closesAt }, now)).toEqual({ tone, text: label });
  });

  it('cerrada: explica que solo van plantillas', () => {
    expect(windowLabel({ open: false, closesAt: null }, now)).toEqual({ tone: 'closed', text: 'Ventana cerrada: solo puedes enviar plantillas aprobadas' });
  });

  it('avisa cuando queda poco (menos de 1 h)', () => {
    expect(windowLabel({ open: true, closesAt: '2026-10-06T12:30:00Z' }, now).tone).toBe('closing');
  });
});
