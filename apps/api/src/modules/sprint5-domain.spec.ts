import { describe, expect, it } from 'vitest';
import { nextAssignee } from './automation/domain/round-robin.js';
import { planLimits } from './billing/domain/plans.js';
import { mapRow, suggestMapping } from './contacts/domain/csv-import.js';
import { buildWaUrl, extractRefCode } from './marketing/domain/wa-link.js';

describe('Importación CSV: mapeo (E02-S08)', () => {
  it('sugiere columnas por nombre, con o sin tildes', () => {
    expect(suggestMapping(['Nombre completo', 'Teléfono', 'E-mail', 'Etiquetas', 'Ciudad', 'Prioridad'], ['ciudad'])).toEqual({
      'Nombre completo': 'name', Teléfono: 'phone', 'E-mail': 'email', Etiquetas: 'tags', Ciudad: 'custom.ciudad', Prioridad: 'priority',
    });
  });

  const defs = [{ key: 'ciudad', label: 'Ciudad', type: 'text' as const, options: [] }];
  const mapping = { Nombre: 'name', Tel: 'phone', Correo: 'email', Tags: 'tags', Prio: 'priority', Tipo: 'kind', Ciudad: 'custom.ciudad', Ignorar: '' };

  it('convierte una fila válida', () => {
    const row = { Nombre: ' Ana Gómez ', Tel: '300 123 4567', Correo: 'ANA@x.co', Tags: 'vip; referido', Prio: 'Alta', Tipo: 'Empresa', Ciudad: 'Cali', Ignorar: 'x' };
    expect(mapRow(row, mapping, { defs, country: 'CO' })).toEqual({
      ok: true,
      values: { name: 'Ana Gómez', phone: '+573001234567', email: 'ana@x.co', tags: ['vip', 'referido'], priority: 'high', kind: 'company', customFields: { ciudad: 'Cali' } },
    });
  });

  it.each([
    ['sin nombre', { Nombre: '' }, /nombre/i],
    ['teléfono inválido', { Nombre: 'X', Tel: '123' }, /teléfono/i],
    ['correo inválido', { Nombre: 'X', Correo: 'nope' }, /correo/i],
    ['prioridad desconocida', { Nombre: 'X', Prio: 'urgentísima' }, /prioridad/i],
  ])('rechaza con motivo legible: %s', (_, row, message) => {
    const result = mapRow(row, mapping, { defs, country: 'CO' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(message);
  });
});

describe('Reparto round-robin (E07-S01)', () => {
  it('rota en orden y vuelve al principio', () => {
    expect(nextAssignee(['a', 'b', 'c'], null)).toBe('a');
    expect(nextAssignee(['a', 'b', 'c'], 'a')).toBe('b');
    expect(nextAssignee(['a', 'b', 'c'], 'c')).toBe('a');
  });
  it('si el último ya no está en el equipo, empieza de nuevo', () => expect(nextAssignee(['a', 'b'], 'z')).toBe('a'));
  it('sin candidatos no asigna', () => expect(nextAssignee([], null)).toBeNull());
});

describe('Enlace Click-to-WhatsApp (E09-S01)', () => {
  it('arma wa.me con el texto y el código de referencia', () => {
    expect(buildWaUrl('+57 300 123 4567', 'Hola, quiero info', 'abc123')).toBe('https://wa.me/573001234567?text=Hola%2C%20quiero%20info%20(ref%3A%20abc123)');
  });
  it('recupera el código desde el primer mensaje del cliente', () => {
    expect(extractRefCode('Hola, quiero info (ref: abc123)')).toBe('abc123');
    expect(extractRefCode('Hola sin código')).toBeNull();
  });
});

describe('Límites del plan (E10-S01)', () => {
  it('el trial define usuarios, canales, IA y almacenamiento', () => {
    expect(planLimits('trial')).toEqual({ maxUsers: 3, maxChannels: 1, aiRepliesPerMonth: 100, storageBytes: 1024 ** 3 });
  });
  it('un plan desconocido cae en el más restrictivo', () => expect(planLimits('inventado')).toEqual(planLimits('trial')));
});
