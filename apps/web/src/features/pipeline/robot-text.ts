/** E07-S04 — Robots por etapa, tal como los devuelve la API. */
export type RobotTrigger = { type: 'enter' } | { type: 'stale'; days: number } | { type: 'no_reply'; hours: number } | { type: 'won' };
export type RobotAction =
  | { type: 'notify'; to: 'owner' | 'admins' }
  | { type: 'task'; title: string; dueHours: number }
  | { type: 'assign'; userId: string }
  | { type: 'move'; stageId: string };
export interface RobotCondition { minValue?: number; unassigned?: boolean }
export interface Robot {
  id: string;
  pipelineId: string;
  stageId: string | null;
  trigger: RobotTrigger;
  condition: RobotCondition;
  action: RobotAction;
  enabled: boolean;
}

interface Names {
  stage: (id: string) => string;
  member: (id: string) => string;
  money: (value: number) => string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Si lleva 3 días y no tiene responsable → avisar al responsable". */
export function describeRobot(robot: Pick<Robot, 'trigger' | 'condition' | 'action'>, names: Names): string {
  const { trigger, condition, action } = robot;
  const when = trigger.type === 'enter' ? 'Al entrar'
    : trigger.type === 'stale' ? `Si lleva ${plural(trigger.days, 'día', 'días')}`
      : trigger.type === 'no_reply' ? `Si el cliente no responde en ${trigger.hours} h`
        : 'Al ganar el negocio';
  const conditions = [
    condition.minValue !== undefined ? `vale al menos ${names.money(condition.minValue)}` : null,
    condition.unassigned ? 'no tiene responsable' : null,
  ].filter(Boolean);
  const what = action.type === 'notify' ? (action.to === 'owner' ? 'avisar al responsable' : 'avisar a propietario y admins')
    : action.type === 'task' ? `crear la tarea "${action.title}"${action.dueHours ? ` (vence en ${action.dueHours} h)` : ''}`
      : action.type === 'assign' ? `asignar a ${names.member(action.userId)}`
        : `mover a ${names.stage(action.stageId)}`;
  return `${when}${conditions.length ? ` y ${conditions.join(' y ')}` : ''} → ${what}`;
}
