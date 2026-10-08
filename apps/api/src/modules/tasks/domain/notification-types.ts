/** E14-S04 — Catálogo de tipos de notificación: el orden es el de la pantalla de preferencias. */
export const NOTIFICATION_TYPES = {
  task_reminder: { label: 'Recordatorios de tareas', emailLocked: false },
  no_reply: { label: 'Clientes esperando respuesta', emailLocked: false },
  sla_breach: { label: 'Primera respuesta fuera de tiempo (SLA)', emailLocked: false },
  deal_won: { label: 'Negocios ganados', emailLocked: false },
  // Avisos de cobro y de cuenta en solo lectura: el propietario no puede dejar de recibirlos por correo.
  billing: { label: 'Plan y pagos', emailLocked: true },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;
export const NOTIFICATION_TYPE_IDS = Object.keys(NOTIFICATION_TYPES) as [NotificationType, ...NotificationType[]];

export interface Preference { inApp: boolean; email: boolean }
export const DEFAULT_PREFERENCE: Preference = { inApp: true, email: true };

/** Preferencia efectiva: lo guardado, o el valor por defecto; el correo bloqueado siempre sale. */
export function effectivePreference(type: string, stored: Preference | undefined): Preference {
  const pref = stored ?? DEFAULT_PREFERENCE;
  const locked = (NOTIFICATION_TYPES as Record<string, { emailLocked: boolean }>)[type]?.emailLocked ?? false;
  return { inApp: pref.inApp, email: locked || pref.email };
}
