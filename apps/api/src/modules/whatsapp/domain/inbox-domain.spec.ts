import { describe, expect, it } from 'vitest';
import { isWithinBusinessHours } from './business-hours.js';
import { consentKeyword } from './consent.js';
import { mediaPolicy } from './media-policy.js';
import { templateComponents, validateTemplate } from './templates.js';

const weekdays = { from: '08:00', to: '18:00' };
const HOURS = { mon: [weekdays], tue: [weekdays], wed: [weekdays], thu: [weekdays], fri: [weekdays], sat: [{ from: '08:00', to: '13:00' }], sun: [] };

describe('Horario laboral en la zona del tenant (E04-S10)', () => {
  it.each([
    ['2026-10-06T14:00:00Z', true], // martes 09:00 Bogotá
    ['2026-10-06T12:59:00Z', false], // martes 07:59 Bogotá
    ['2026-10-06T23:00:00Z', false], // martes 18:00 Bogotá (el cierre no se incluye)
    ['2026-10-10T17:59:00Z', true], // sábado 12:59 Bogotá
    ['2026-10-11T15:00:00Z', false], // domingo
    ['2026-10-07T03:00:00Z', false], // martes 22:00 Bogotá aunque en UTC ya sea miércoles
  ])('%s → %s', (iso, expected) => {
    expect(isWithinBusinessHours(HOURS, 'America/Bogota', new Date(iso))).toBe(expected);
  });
});

describe('Palabras de consentimiento (E04-S09)', () => {
  it.each(['BAJA', 'baja', ' Stop ', 'CANCELAR.', 'No más mensajes', 'no mas', 'desuscribir'])('"%s" es baja', (text) => {
    expect(consentKeyword(text)).toBe('opt_out');
  });
  it.each(['ALTA', 'start', 'Suscribir'])('"%s" es alta', (text) => expect(consentKeyword(text)).toBe('opt_in'));
  it.each(['¿me das de baja el pedido de ayer?', 'hola', '', 'stop por favor no, era broma'])('"%s" no es una palabra clave', (text) => {
    expect(consentKeyword(text)).toBeNull();
  });
});

describe('Plantillas (E04-S05)', () => {
  const base = { name: 'recordatorio_cita', category: 'UTILITY' as const, body: 'Hola {{1}}, tu cita es el {{2}}.', examples: ['Ana', '7 de octubre'] };

  it('valida y cuenta variables', () => expect(validateTemplate(base)).toEqual({ variables: 2 }));
  it.each([
    ['variables salteadas', { body: 'Hola {{1}}, {{3}}', examples: ['a', 'b'] }],
    ['faltan ejemplos', { examples: ['Ana'] }],
    ['cuerpo muy largo', { body: 'x'.repeat(1025), examples: [] }],
    ['nombre con mayúsculas', { name: 'Recordatorio' }],
    ['variables pegadas', { body: 'Hola {{1}}{{2}}', examples: ['a', 'b'] }],
  ])('rechaza: %s', (_, override) => expect(() => validateTemplate({ ...base, ...override })).toThrow());

  it('arma los componentes para la Cloud API', () => {
    expect(templateComponents(['Ana', '7 de octubre'])).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: '7 de octubre' }] },
    ]);
    expect(templateComponents([])).toEqual([]);
  });
});

describe('Política de multimedia (E04-S06)', () => {
  it.each([
    ['audio/ogg', 16, true],
    ['image/jpeg', 5, true],
    ['video/mp4', 16, true],
    ['application/pdf', 100, true],
    ['image/svg+xml', 5, false], // puede traer scripts: se descarga, nunca se muestra en línea
    ['text/html', 100, false],
  ])('%s → máx %i MB, en línea=%s', (mime, mb, inline) => {
    expect(mediaPolicy(mime)).toEqual({ maxBytes: mb * 1024 * 1024, inline });
  });
});
