/**
 * Roles del tenant (E01-S04 los completa con la matriz de permisos).
 * Coinciden con `member.role` de Better Auth: el plugin organization usa owner/admin/member.
 * "member" es el VENDEDOR en el lenguaje del negocio.
 */
export type Role = 'owner' | 'admin' | 'member';
