import type { TeamRole } from '../team/roles';

export type SettingsTab = 'general' | 'canales' | 'ia' | 'plan' | 'privacidad';

/** Agrupación de Configuración. Las notificaciones enlazan a `/settings?tab=…`. */
const TABS: { id: SettingsTab; label: string; icon: string; roles: TeamRole[] }[] = [
  { id: 'general', label: 'General', icon: '⚙', roles: ['owner', 'admin', 'member'] },
  { id: 'canales', label: 'WhatsApp y automatizaciones', icon: '✆', roles: ['owner', 'admin', 'member'] },
  { id: 'ia', label: 'Asistente IA', icon: '✦', roles: ['owner', 'admin'] },
  { id: 'plan', label: 'Plan y pagos', icon: '$', roles: ['owner'] },
  { id: 'privacidad', label: 'Privacidad y seguridad', icon: '⛨', roles: ['owner', 'admin'] },
];

export function tabsFor(role: TeamRole) {
  return TABS.filter((t) => t.roles.includes(role));
}

export function tabFrom(value: unknown, role: TeamRole): SettingsTab {
  return tabsFor(role).find((t) => t.id === value)?.id ?? 'general';
}
