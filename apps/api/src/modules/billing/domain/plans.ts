export interface PlanLimits {
  maxUsers: number;
  maxChannels: number;
  aiRepliesPerMonth: number;
  storageBytes: number;
}

/**
 * E10-S01 — Límites por plan, aplicados en todo el sistema (invitaciones, conexión de números,
 * multimedia e importaciones, IA). Los planes pagos llegan con E10-S03.
 */
export const PLANS = {
  trial: { maxUsers: 3, maxChannels: 1, aiRepliesPerMonth: 100, storageBytes: 1024 ** 3 },
} as const satisfies Record<string, PlanLimits>;

export type PlanId = keyof typeof PLANS;

export function planLimits(plan: string): PlanLimits {
  return PLANS[plan as PlanId] ?? PLANS.trial;
}
