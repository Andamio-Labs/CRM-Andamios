import { describe, expect, it } from 'vitest';
import { daysInStage, describeEvent } from './deal-format';

const stages: Record<string, string> = { s1: 'Nuevo', s2: 'Propuesta' };
const name = (id: unknown) => stages[String(id)] ?? 'otra etapa';
const event = (type: string, data: Record<string, unknown> = {}) => ({ type, data, actorId: null, createdAt: '2026-11-01T10:00:00Z' });

describe('ficha del negocio', () => {
  it('cuenta los días completos en la etapa', () => {
    const now = new Date('2026-11-09T15:00:00Z');
    expect(daysInStage('2026-11-06T16:00:00Z', now)).toBe(2);
    expect(daysInStage('2026-11-10T00:00:00Z', now)).toBe(0);
  });

  it.each([
    [event('created', { stageId: 's1' }), 'Se creó en Nuevo'],
    [event('stage_changed', { from: 's1', to: 's2' }), 'Pasó de Nuevo a Propuesta'],
    [event('stage_changed', { from: 's1', to: 's2', robotId: 'r1' }), 'Pasó de Nuevo a Propuesta (lo movió un robot)'],
    [event('won', { reason: 'Buen precio', note: 'Pagó de contado' }), 'Ganado: Buen precio — Pagó de contado'],
    [event('lost', { reason: 'Se fue con la competencia' }), 'Perdido: Se fue con la competencia'],
    [event('claimed'), 'Lo tomó del pool de leads'],
  ])('%#', (e, text) => expect(describeEvent(e, name)).toBe(text));
});
