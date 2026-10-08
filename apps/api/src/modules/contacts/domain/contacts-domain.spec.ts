import { describe, expect, it } from 'vitest';
import type { CustomFieldType } from '../../../shared/database/schema.js';
import { currentConsents } from './consent.js';
import { validateCustomFieldValues } from './custom-fields.js';
import { normalizePhone } from './phone.js';

describe('normalizePhone (E02-S01)', () => {
  it.each([
    ['3001234567', 'CO', '+573001234567'],
    ['300 123 4567', 'CO', '+573001234567'],
    ['+57 (300) 123-4567', 'CO', '+573001234567'],
    ['+52 55 1234 5678', 'CO', '+525512345678'],
    ['987654321', 'PE', '+51987654321'],
    ['+56 9 6123 4567', 'CO', '+56961234567'],
    ['+54 9 11 2345 6789', 'CO', '+5491123456789'],
  ])('%s (país %s) → %s', (input, country, expected) => {
    expect(normalizePhone(input, country as never)).toBe(expected);
  });

  it.each([['123'], ['abc'], ['+57 123'], ['+44 20 7946 0958'], ['+1 202 555 0143']])('rechaza %s', (input) => {
    expect(() => normalizePhone(input, 'CO')).toThrow();
  });
});

describe('validateCustomFieldValues (E02-S04)', () => {
  const def = (key: string, type: CustomFieldType, options: string[] = []) => ({ key, type, options, label: key });
  const defs = [
    def('ciudad', 'text'),
    def('hijos', 'number'),
    def('cumple', 'date'),
    def('plan', 'select', ['basico', 'pro']),
    def('intereses', 'multiselect', ['web', 'app', 'ia']),
    def('presupuesto', 'currency'),
  ];

  it('acepta valores válidos y limpia los null', () => {
    expect(
      validateCustomFieldValues(defs, {
        ciudad: ' Medellín ', hijos: 2, cumple: '1990-05-20', plan: 'pro', intereses: ['web', 'ia'], presupuesto: 1500000.5,
      }),
    ).toEqual({ ciudad: 'Medellín', hijos: 2, cumple: '1990-05-20', plan: 'pro', intereses: ['web', 'ia'], presupuesto: 1500000.5 });
    expect(validateCustomFieldValues(defs, { ciudad: null })).toEqual({ ciudad: null });
  });

  it.each([
    ['campo inexistente', { color: 'rojo' }],
    ['número como texto', { hijos: 'dos' }],
    ['fecha imposible', { cumple: '2026-02-30' }],
    ['opción fuera de la lista', { plan: 'enterprise' }],
    ['multiselección con opción inválida', { intereses: ['web', 'tv'] }],
    ['multiselección que no es lista', { intereses: 'web' }],
    ['moneda negativa', { presupuesto: -1 }],
    ['texto gigante', { ciudad: 'x'.repeat(1001) }],
  ])('rechaza %s', (_, values) => {
    expect(() => validateCustomFieldValues(defs, values)).toThrow();
  });
});

describe('currentConsents (E13-S02)', () => {
  const at = (iso: string) => new Date(iso);
  it('cada finalidad toma su registro más reciente, sin importar el orden de llegada', () => {
    const current = currentConsents([
      { purposes: ['marketing'], granted: false, recordedAt: at('2026-03-01'), legalBasis: 'consent', channel: 'phone' },
      { purposes: ['sales', 'marketing'], granted: true, recordedAt: at('2026-01-01'), legalBasis: 'consent', channel: 'web_form' },
    ]);
    expect(current.sales).toMatchObject({ granted: true, channel: 'web_form' });
    expect(current.marketing).toMatchObject({ granted: false, channel: 'phone' });
    expect(current.billing).toBeUndefined();
  });
});
