import { z } from 'zod';
import type { RobotAction, RobotCondition, RobotTrigger } from '../../../shared/database/schema.js';

/** E07-S04 — Robots por etapa: "cuando → si → hacer". */
export const robotTriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('enter') }).strict(),
  z.object({ type: z.literal('stale'), days: z.number().int().min(1).max(90) }).strict(),
  z.object({ type: z.literal('no_reply'), hours: z.number().int().min(1).max(720) }).strict(),
  z.object({ type: z.literal('won') }).strict(),
]);

export const robotActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('notify'), to: z.enum(['owner', 'admins']) }).strict(),
  z.object({ type: z.literal('task'), title: z.string().trim().min(1).max(200), dueHours: z.number().int().min(0).max(720) }).strict(),
  z.object({ type: z.literal('assign'), userId: z.string().min(1).max(64) }).strict(),
  z.object({ type: z.literal('move'), stageId: z.uuid() }).strict(),
]);

export const robotConditionSchema = z.object({
  minValue: z.number().min(0).max(1e13).optional(),
  unassigned: z.boolean().optional(),
}).strict();

/** "Si": todas las condiciones puestas deben cumplirse. */
export function matchesCondition(condition: RobotCondition, deal: { value: number; ownerId: string | null }): boolean {
  if (condition.minValue !== undefined && deal.value < condition.minValue) return false;
  if (condition.unassigned && deal.ownerId !== null) return false;
  return true;
}

/** Qué pasó, para el aviso al equipo: "Lleva 3 días en Propuesta". */
export function triggerText(trigger: RobotTrigger, stageName: string | null): string {
  switch (trigger.type) {
    case 'enter': return `Entró a ${stageName ?? 'la etapa'}`;
    case 'stale': return `Lleva ${trigger.days} ${trigger.days === 1 ? 'día' : 'días'} en ${stageName ?? 'la etapa'}`;
    case 'no_reply': return `El cliente no responde hace ${trigger.hours} h`;
    case 'won': return 'Negocio ganado';
  }
}

export type { RobotAction, RobotCondition, RobotTrigger };
