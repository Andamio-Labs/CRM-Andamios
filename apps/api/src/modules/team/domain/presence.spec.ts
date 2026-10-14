import { describe, expect, it } from 'vitest';
import { effectivePresence, mutesAlerts, takesNewLeads } from './presence.js';

const now = new Date('2026-10-08T15:00:00Z');
const later = new Date('2026-10-08T16:00:00Z');
const earlier = new Date('2026-10-08T14:00:00Z');

describe('Estado del empleado (E01-S09)', () => {
  it('sin nada elegido, en línea; sin sesión abierta, desconectado', () => {
    expect(effectivePresence(undefined, true, now)).toBe('online');
    expect(effectivePresence({ status: 'dnd', until: null }, false, now)).toBe('offline');
  });

  it('lo elegido dura hasta que vence; después vuelve a en línea', () => {
    expect(effectivePresence({ status: 'visit', until: later }, true, now)).toBe('visit');
    expect(effectivePresence({ status: 'visit', until: earlier }, true, now)).toBe('online');
    expect(effectivePresence({ status: 'dnd', until: null }, true, now)).toBe('dnd');
  });

  it('solo en línea y en visita reciben leads nuevos', () => {
    expect(['online', 'visit', 'dnd', 'offline'].filter((s) => takesNewLeads(s as never))).toEqual(['online', 'visit']);
  });

  it('no molestar y desconectado elegidos silencian push y correo mientras duran', () => {
    expect(mutesAlerts({ status: 'dnd', until: later }, now)).toBe(true);
    expect(mutesAlerts({ status: 'offline', until: null }, now)).toBe(true);
    expect(mutesAlerts({ status: 'dnd', until: earlier }, now)).toBe(false);
    expect(mutesAlerts({ status: 'visit', until: null }, now)).toBe(false);
    expect(mutesAlerts(undefined, now)).toBe(false);
  });
});
