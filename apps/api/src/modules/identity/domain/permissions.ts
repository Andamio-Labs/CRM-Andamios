import type { Role } from './roles.js';

/**
 * E01-S04 — Matriz de permisos. ÚNICA fuente de verdad: guards, casos de uso y
 * docs/permissions.md salen de acá (un test verifica que el doc esté sincronizado).
 */
const MATRIX = {
  'settings:read': { owner: true, admin: true, member: true, label: 'Ver configuración de la empresa' },
  'settings:update': { owner: true, admin: false, member: false, label: 'Editar configuración de la empresa' },
  'members:read': { owner: true, admin: true, member: false, label: 'Ver el equipo' },
  'members:invite': { owner: true, admin: true, member: false, label: 'Invitar vendedores' },
  'members:invite-admin': { owner: true, admin: false, member: false, label: 'Invitar administradores' },
  'members:change-role': { owner: true, admin: false, member: false, label: 'Cambiar el rol de un usuario' },
  'members:remove': { owner: true, admin: true, member: false, label: 'Quitar usuarios (admin: solo vendedores)' },
  'records:read': { owner: true, admin: true, member: true, label: 'Ver contactos, negocios y conversaciones (*)' },
  'records:write': { owner: true, admin: true, member: true, label: 'Crear y editar contactos, negocios y tareas (*)' },
  'records:delete': { owner: true, admin: true, member: false, label: 'Eliminar contactos y negocios' },
  'fields:manage': { owner: true, admin: true, member: false, label: 'Crear y editar campos personalizados' },
  'pipelines:manage': { owner: true, admin: true, member: false, label: 'Configurar embudos, etapas y motivos de cierre' },
  'views:share': { owner: true, admin: true, member: false, label: 'Compartir vistas con el equipo' },
  'channels:manage': { owner: true, admin: false, member: false, label: 'Conectar y desconectar números de WhatsApp' },
  'templates:manage': { owner: true, admin: true, member: false, label: 'Gestionar plantillas de WhatsApp y respuestas rápidas' },
  'automation:manage': { owner: true, admin: true, member: false, label: 'Configurar automatizaciones y agente de IA' },
  'reports:read-team': { owner: true, admin: true, member: false, label: 'Ver reportes de todo el equipo' },
  'data:import': { owner: true, admin: true, member: false, label: 'Importar contactos (CSV)' },
  'data:export': { owner: true, admin: false, member: false, label: 'Exportar datos (CSV)' },
  'audit:read': { owner: true, admin: false, member: false, label: 'Ver registro de auditoría' },
  'billing:manage': { owner: true, admin: false, member: false, label: 'Gestionar plan y pagos' },
  'tenant:delete': { owner: true, admin: false, member: false, label: 'Eliminar la empresa y sus datos' },
} as const satisfies Record<string, Record<Role, boolean> & { label: string }>;

export type Action = keyof typeof MATRIX;

export function can(role: Role, action: Action): boolean {
  const row = MATRIX[action] as Record<string, unknown>;
  return row?.[role] === true;
}

/**
 * (*) Regla del tenant: si `sellersSeeOnlyAssigned` está activa, el vendedor solo ve
 * los registros asignados a él. Los repositorios de E02/E03/E04 filtran según este scope.
 */
export function recordVisibility(role: Role, settings: { sellersSeeOnlyAssigned: boolean }): 'all' | 'assigned' {
  return role === 'member' && settings.sellersSeeOnlyAssigned ? 'assigned' : 'all';
}

const ROLE_LABELS: Record<Role, string> = { owner: 'Propietario', admin: 'Admin', member: 'Vendedor' };

export function renderPermissionMatrix(): string {
  const roles = Object.keys(ROLE_LABELS) as Role[];
  const header = `| Acción | Permiso | ${roles.map((r) => ROLE_LABELS[r]).join(' | ')} |`;
  const divider = `|---|---|${roles.map(() => ':-:').join('|')}|`;
  const rows = (Object.entries(MATRIX) as [Action, (typeof MATRIX)[Action]][]).map(
    ([action, row]) => `| ${row.label} | \`${action}\` | ${roles.map((r) => (row[r] ? '✅' : '—')).join(' | ')} |`,
  );
  return [header, divider, ...rows].join('\n');
}
