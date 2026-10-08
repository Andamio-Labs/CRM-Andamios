import { describe, expect, it } from 'vitest';
import { tabFrom, tabsFor } from './settings-tabs';

describe('Pestañas de configuración', () => {
  it('cada rol ve solo lo que puede gestionar', () => {
    expect(tabsFor('owner').map((t) => t.id)).toEqual(['general', 'canales', 'ia', 'plan', 'privacidad']);
    expect(tabsFor('admin').map((t) => t.id)).toEqual(['general', 'canales', 'ia', 'privacidad']);
    expect(tabsFor('member').map((t) => t.id)).toEqual(['general', 'canales']);
  });

  it('lee la pestaña de la URL y cae en General si no existe o no le corresponde', () => {
    expect(tabFrom('ia', 'owner')).toBe('ia');
    expect(tabFrom('plan', 'admin')).toBe('general');
    expect(tabFrom('inventada', 'owner')).toBe('general');
    expect(tabFrom(undefined, 'member')).toBe('general');
  });
});
