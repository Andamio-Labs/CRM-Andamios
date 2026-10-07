/** Nombres de negocio para los roles técnicos (ver docs/permissions.md). */
export type TeamRole = 'owner' | 'admin' | 'member';

export const ROLE_LABELS: Record<TeamRole, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  member: 'Vendedor',
};
