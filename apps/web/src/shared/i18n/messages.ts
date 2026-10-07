/**
 * E14-S02 — Catálogo de textos. es-CO es la base completa; cada idioma sobrescribe solo lo que cambia.
 * Migración incremental: las pantallas nuevas usan t(); las existentes se pasan de a poco.
 */
const esCO = {
  'nav.home': 'Dashboard',
  'nav.tasks': 'Tareas',
  'nav.deals': 'Negocios',
  'nav.inbox': 'Conversaciones',
  'nav.contacts': 'Clientes',
  'nav.team': 'Equipo',
  'nav.settings': 'Configuración',
  'nav.signOut': 'Cerrar sesión',
} as const;

export type MessageKey = keyof typeof esCO;

const catalogs: Record<string, Partial<Record<MessageKey, string>>> = {
  'es-CO': esCO,
  'es-MX': {},
  'pt-BR': {
    'nav.home': 'Dashboard',
    'nav.tasks': 'Tarefas',
    'nav.deals': 'Negócios',
    'nav.inbox': 'Conversas',
    'nav.contacts': 'Clientes',
    'nav.team': 'Equipe',
    'nav.settings': 'Configurações',
    'nav.signOut': 'Sair',
  },
};

export function translator(locale: string) {
  const catalog = catalogs[locale] ?? {};
  return (key: MessageKey) => catalog[key] ?? esCO[key];
}
