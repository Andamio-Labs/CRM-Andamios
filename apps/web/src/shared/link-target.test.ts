import { describe, expect, it } from 'vitest';
import { linkTarget } from './link-target';

describe('linkTarget', () => {
  it('separa la ruta de los parámetros: el router los espera por separado', () => {
    expect(linkTarget('/inbox?c=abc-123')).toEqual({ to: '/inbox', search: { c: 'abc-123' } });
    expect(linkTarget('/settings?tab=ia')).toEqual({ to: '/settings', search: { tab: 'ia' } });
    expect(linkTarget('/contacts')).toEqual({ to: '/contacts', search: {} });
  });

  it('un enlace vacío o externo lleva al inicio', () => {
    expect(linkTarget(null)).toEqual({ to: '/', search: {} });
    expect(linkTarget('https://otro-sitio.com/x')).toEqual({ to: '/', search: {} });
    expect(linkTarget('//otro-sitio.com')).toEqual({ to: '/', search: {} });
  });
});
