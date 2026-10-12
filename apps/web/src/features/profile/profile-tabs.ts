export type ProfileTab = 'perfil' | 'empresa' | 'notificaciones';

/** Pestañas de /profile. La tuerca de la campana abre `?tab=notificaciones`. */
export const PROFILE_TABS: { id: ProfileTab; label: string }[] = [
  { id: 'perfil', label: 'Perfil' },
  { id: 'empresa', label: 'Empresa' },
  { id: 'notificaciones', label: 'Notificaciones' },
];

export function profileTabFrom(value: unknown): ProfileTab {
  return PROFILE_TABS.find((t) => t.id === value)?.id ?? 'perfil';
}
