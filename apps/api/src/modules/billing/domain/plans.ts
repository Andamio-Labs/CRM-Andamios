export interface PlanLimits {
  maxUsers: number;
  maxChannels: number;
  aiRepliesPerMonth: number;
  storageBytes: number;
}

/**
 * E10-S01 — Límites por plan, aplicados en todo el sistema (invitaciones, conexión de números,
 * multimedia e importaciones, IA). E10-S03 — Planes pagos con precio mensual en COP.
 *
 * ⚠️ PRECIOS Y LÍMITES PROVISIONALES: los define el dueño del producto antes del lanzamiento.
 */
export const PLANS = {
  trial: { name: 'Prueba', priceCop: 0, maxUsers: 3, maxChannels: 1, aiRepliesPerMonth: 100, storageBytes: 1024 ** 3 },
  basic: { name: 'Básico', priceCop: 99_000, maxUsers: 3, maxChannels: 1, aiRepliesPerMonth: 500, storageBytes: 5 * 1024 ** 3 },
  pro: { name: 'Profesional', priceCop: 249_000, maxUsers: 10, maxChannels: 3, aiRepliesPerMonth: 3000, storageBytes: 20 * 1024 ** 3 },
} as const satisfies Record<string, PlanLimits & { name: string; priceCop: number }>;

export type PlanId = keyof typeof PLANS;
export type PaidPlanId = Exclude<PlanId, 'trial'>;

export const PAID_PLANS = (Object.entries(PLANS) as [PlanId, (typeof PLANS)[PlanId]][])
  .filter(([id]) => id !== 'trial')
  .map(([id, plan]) => ({ id: id as PaidPlanId, ...plan }));

export function planLimits(plan: string): PlanLimits {
  const { maxUsers, maxChannels, aiRepliesPerMonth, storageBytes } = PLANS[plan as PlanId] ?? PLANS.trial;
  return { maxUsers, maxChannels, aiRepliesPerMonth, storageBytes };
}
