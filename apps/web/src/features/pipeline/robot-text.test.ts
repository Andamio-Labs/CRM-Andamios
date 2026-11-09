import { describe, expect, it } from 'vitest';
import { describeRobot } from './robot-text';

const names = { stage: (id: string) => ({ s2: 'Propuesta' })[id] ?? '?', member: () => 'Valentina', money: (v: number) => `$${v}` };

describe('describeRobot (E07-S04)', () => {
  it.each([
    [{ trigger: { type: 'enter' }, condition: {}, action: { type: 'task', title: 'Enviar cotización', dueHours: 24 } }, 'Al entrar → crear la tarea "Enviar cotización" (vence en 24 h)'],
    [{ trigger: { type: 'stale', days: 1 }, condition: {}, action: { type: 'notify', to: 'owner' } }, 'Si lleva 1 día → avisar al responsable'],
    [{ trigger: { type: 'stale', days: 3 }, condition: { unassigned: true }, action: { type: 'assign', userId: 'u1' } }, 'Si lleva 3 días y no tiene responsable → asignar a Valentina'],
    [{ trigger: { type: 'no_reply', hours: 24 }, condition: {}, action: { type: 'move', stageId: 's2' } }, 'Si el cliente no responde en 24 h → mover a Propuesta'],
    [{ trigger: { type: 'won' }, condition: { minValue: 1000 }, action: { type: 'notify', to: 'admins' } }, 'Al ganar el negocio y vale al menos $1000 → avisar a propietario y admins'],
  ] as const)('%#', (robot, text) => {
    expect(describeRobot(robot as never, names)).toBe(text);
  });
});
