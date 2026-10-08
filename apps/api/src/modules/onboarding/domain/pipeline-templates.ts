/** E14-S03 / E03-S06 — Plantillas de embudo por sector, para arrancar sin configurar etapas a mano. */
export const PIPELINE_TEMPLATES = {
  general: { name: 'Ventas', label: 'General', stages: ['Nuevo', 'Contactado', 'Propuesta', 'Negociación'] },
  clinic: { name: 'Clínica', label: 'Clínica o consultorio', stages: ['Nuevo', 'Cita agendada', 'Valoración', 'Tratamiento propuesto', 'En tratamiento'] },
  real_estate: { name: 'Inmobiliaria', label: 'Inmobiliaria', stages: ['Nuevo', 'Calificado', 'Visita agendada', 'Oferta', 'Promesa de compraventa'] },
  education: { name: 'Admisiones', label: 'Educación', stages: ['Interesado', 'Información enviada', 'Entrevista o visita', 'Matrícula en proceso'] },
  retail: { name: 'Pedidos', label: 'Comercio', stages: ['Nuevo', 'Cotización enviada', 'Pedido confirmado', 'Pago pendiente'] },
  services: { name: 'Servicios', label: 'Servicios profesionales', stages: ['Nuevo', 'Diagnóstico', 'Propuesta', 'Negociación', 'Contrato'] },
} as const;

export type PipelineTemplateId = keyof typeof PIPELINE_TEMPLATES;
export const PIPELINE_TEMPLATE_IDS = Object.keys(PIPELINE_TEMPLATES) as [PipelineTemplateId, ...PipelineTemplateId[]];

export const ONBOARDING_STEPS = [
  { key: 'whatsapp', label: 'Conectar tu número de WhatsApp', link: '/settings' },
  { key: 'pipeline', label: 'Elegir la plantilla de tu embudo', link: '/' },
  { key: 'import', label: 'Importar tus contactos', link: '/contacts' },
  { key: 'team', label: 'Invitar a tu equipo', link: '/team' },
] as const;

/** Avance en porcentaje entero de los pasos completos. */
export function progressOf(done: readonly boolean[]): number {
  return done.length ? Math.round((done.filter(Boolean).length / done.length) * 100) : 0;
}
