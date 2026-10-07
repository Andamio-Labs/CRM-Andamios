import { describe, expect, it } from 'vitest';
import { applyRemoteDeal, type Board, moveDeal } from './board-state';

const deal = (id: string, stageId: string, position: number) => ({ id, title: id, stageId, position, value: 0, currency: 'COP', ownerId: null, status: 'open' as const });
const board: Board = {
  stages: [
    { id: 's1', name: 'Nuevo', color: '#000000', deals: [deal('a', 's1', 1), deal('b', 's1', 2)] },
    { id: 's2', name: 'Propuesta', color: '#000000', deals: [deal('c', 's2', 1)] },
  ],
};
const titles = (b: Board) => b.stages.map((s) => s.deals.map((d) => d.id));

describe('moveDeal (optimista)', () => {
  it('mueve a otra columna después de un negocio', () => {
    expect(titles(moveDeal(board, 'a', 's2', 'c'))).toEqual([['b'], ['c', 'a']]);
  });
  it('mueve al principio de una columna (after = null)', () => {
    expect(titles(moveDeal(board, 'b', 's2', null))).toEqual([['a'], ['b', 'c']]);
  });
  it('reordena dentro de la misma columna', () => {
    expect(titles(moveDeal(board, 'a', 's1', 'b'))).toEqual([['b', 'a'], ['c']]);
  });
  it('no muta el estado original', () => {
    moveDeal(board, 'a', 's2', 'c');
    expect(titles(board)).toEqual([['a', 'b'], ['c']]);
  });
});

describe('applyRemoteDeal (evento en tiempo real)', () => {
  it('ubica el negocio por posición en su nueva etapa', () => {
    const next = applyRemoteDeal(board, { dealId: 'a', stageId: 's2', position: 0.5, status: 'open' });
    expect(titles(next)).toEqual([['b'], ['a', 'c']]);
  });
  it('un negocio cerrado sale del tablero', () => {
    expect(titles(applyRemoteDeal(board, { dealId: 'c', stageId: 's2', position: 1, status: 'won' }))).toEqual([['a', 'b'], []]);
  });
  it('un negocio desconocido se ignora (se resuelve recargando)', () => {
    expect(applyRemoteDeal(board, { dealId: 'zzz', stageId: 's2', position: 1, status: 'open' })).toBe(board);
  });
});
