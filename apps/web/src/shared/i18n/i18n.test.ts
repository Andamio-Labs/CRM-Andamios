import { describe, expect, it } from 'vitest';
import { createFormatters } from './format';
import { translator } from './messages';

/** E14-S02 — Formatos por país del tenant; español de Colombia por defecto. */
describe('createFormatters', () => {
  // Intl separa con espacio duro (U+00A0): normalizamos para comparar.
  const plain = (s: string) => s.replace(/\s/g, ' ');

  it('Colombia: pesos sin decimales y separador de miles con punto', () => {
    const f = createFormatters({ locale: 'es-CO', currency: 'COP', timeZone: 'America/Bogota' });
    expect(plain(f.money(4500000))).toBe('$ 4.500.000');
  });

  it('México y Brasil usan sus convenciones', () => {
    expect(plain(createFormatters({ locale: 'es-MX', currency: 'MXN', timeZone: 'America/Mexico_City' }).money(1234.5))).toBe('$1,234.50');
    expect(plain(createFormatters({ locale: 'pt-BR', currency: 'BRL', timeZone: 'America/Sao_Paulo' }).money(1234.5))).toBe('R$ 1.234,50');
  });

  it('la moneda del negocio puede ser distinta a la del tenant', () => {
    const f = createFormatters({ locale: 'es-CO', currency: 'COP', timeZone: 'America/Bogota' });
    expect(plain(f.money(100, 'USD'))).toBe('US$ 100,00');
  });

  it('las fechas se muestran en la zona horaria del tenant, no en la del navegador', () => {
    const instant = new Date('2026-10-07T02:30:00Z'); // 6 oct 21:30 en Bogotá
    const bogota = createFormatters({ locale: 'es-CO', currency: 'COP', timeZone: 'America/Bogota' });
    expect(bogota.date(instant)).toBe('6/10/2026');
    expect(plain(bogota.time(instant))).toMatch(/9:30\sp\.\sm\./);
  });
});

describe('translator', () => {
  it('es-CO es la base; es-MX y pt-BR heredan lo que no traducen', () => {
    expect(translator('es-CO')('nav.deals')).toBe('Negocios');
    expect(translator('pt-BR')('nav.deals')).toBe('Negócios');
    expect(translator('es-MX')('nav.deals')).toBe('Negocios');
  });

  it('un idioma desconocido cae en es-CO', () => {
    expect(translator('fr-FR')('nav.contacts')).toBe('Clientes');
  });
});
