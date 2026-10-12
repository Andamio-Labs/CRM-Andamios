/**
 * E14-S04 — Catálogo de tipos de notificación: el orden es el de la pantalla de preferencias.
 * `important` alimenta el filtro "Importantes" de la campana.
 */
export const NOTIFICATION_TYPES = {
  task_reminder: { label: 'Recordatorios', description: 'Tus tareas y seguimientos por vencer', emailLocked: false, important: false },
  no_reply: { label: 'Clientes esperando respuesta', description: 'Conversaciones sin contestar hace varias horas', emailLocked: false, important: false },
  sla_breach: { label: 'Primera respuesta fuera de tiempo', description: 'Conversaciones que superaron el tiempo de respuesta (SLA)', emailLocked: false, important: true },
  deal_won: { label: 'Negocios ganados', description: 'Cuando alguien del equipo cierra un negocio', emailLocked: false, important: false },
  ai_handoff: { label: 'Traspasos del asistente', description: 'El asistente de IA te pasó un cliente', emailLocked: false, important: true },
  ai_quota: { label: 'Cuota del asistente de IA', description: 'Avisos al 80 % y al 100 % de las respuestas del mes', emailLocked: false, important: false },
  join_request: { label: 'Solicitudes para unirse', description: 'Alguien pidió entrar a la empresa con el código', emailLocked: false, important: true },
  // Avisos de cobro y de cuenta en solo lectura: el propietario no puede dejar de recibirlos por correo.
  billing: { label: 'Plan y pagos', description: 'Fin de la prueba, cobros y cuenta en solo lectura', emailLocked: true, important: true },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;
export const NOTIFICATION_TYPE_IDS = Object.keys(NOTIFICATION_TYPES) as [NotificationType, ...NotificationType[]];

export interface Preference { inApp: boolean; email: boolean; push: boolean }
export const DEFAULT_PREFERENCE: Preference = { inApp: true, email: true, push: true };

/** Preferencia efectiva: lo guardado, o el valor por defecto; el correo bloqueado siempre sale. */
export function effectivePreference(type: string, stored: Preference | undefined): Preference {
  const pref = stored ?? DEFAULT_PREFERENCE;
  const locked = (NOTIFICATION_TYPES as Record<string, { emailLocked: boolean }>)[type]?.emailLocked ?? false;
  return { inApp: pref.inApp, email: locked || pref.email, push: pref.push };
}

export function isImportant(type: string) {
  return (NOTIFICATION_TYPES as Record<string, { important: boolean }>)[type]?.important ?? false;
}
