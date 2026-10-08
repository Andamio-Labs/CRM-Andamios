import { SetMetadata } from '@nestjs/common';

export const AUDIT_VIEW_KEY = 'auditView';
export const NO_AUDIT_KEY = 'noAudit';

/** E13-S06 — La ruta muestra datos personales: queda registrado quién los vio. */
export const AuditView = () => SetMetadata(AUDIT_VIEW_KEY, true);

/**
 * E13-S06 — La mutación no se audita automáticamente: o es ruido (marcar notificaciones leídas)
 * o el caso de uso ya escribe su propio registro, más preciso (exportar, importar, fusionar, tarjeta).
 */
export const NoAudit = () => SetMetadata(NO_AUDIT_KEY, true);
