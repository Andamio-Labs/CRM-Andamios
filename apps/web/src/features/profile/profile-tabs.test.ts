import { describe, expect, it } from 'vitest';
import { PROFILE_TABS, profileTabFrom } from './profile-tabs';

describe('Pestañas del perfil', () => {
  it('perfil, empresa y notificaciones, en ese orden', () => {
    expect(PROFILE_TABS.map((t) => t.id)).toEqual(['perfil', 'empresa', 'notificaciones']);
  });

  it('lee la pestaña de la URL y cae en Perfil si no existe', () => {
    expect(profileTabFrom('notificaciones')).toBe('notificaciones');
    expect(profileTabFrom('inventada')).toBe('perfil');
    expect(profileTabFrom(undefined)).toBe('perfil');
  });
});
