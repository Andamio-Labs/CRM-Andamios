export interface BoardDeal {
  id: string;
  title: string;
  stageId: string;
  position: number;
  value: number;
  currency: string;
  ownerId: string | null;
  status: 'open' | 'won' | 'lost';
}
export interface BoardStage {
  id: string;
  name: string;
  color: string;
  deals: BoardDeal[];
}
export interface Board {
  stages: BoardStage[];
}
export interface RemoteDeal {
  dealId: string;
  stageId: string;
  position: number;
  status: string;
}

type AnyBoard<D extends BoardDeal> = { stages: (Omit<BoardStage, 'deals'> & { deals: D[] })[] };
const findDeal = <D extends BoardDeal>(board: AnyBoard<D>, id: string) => board.stages.flatMap((s) => s.deals).find((d) => d.id === id);
const without = <D extends BoardDeal>(board: AnyBoard<D>, id: string) => board.stages.map((s) => ({ ...s, deals: s.deals.filter((d) => d.id !== id) }));

/** Movimiento optimista: la UI cambia al instante; si el servidor falla, se recarga el tablero. */
export function moveDeal<D extends BoardDeal, B extends AnyBoard<D>>(board: B, dealId: string, toStageId: string, afterDealId: string | null): B {
  const deal = findDeal(board, dealId);
  if (!deal) return board;
  const stages = without(board, dealId).map((s) => {
    if (s.id !== toStageId) return s;
    const index = afterDealId === null ? 0 : s.deals.findIndex((d) => d.id === afterDealId) + 1;
    const deals = [...s.deals];
    deals.splice(index, 0, { ...deal, stageId: toStageId });
    return { ...s, deals };
  });
  return { ...board, stages };
}

/** Evento de otro usuario: la posición del servidor manda. */
export function applyRemoteDeal<D extends BoardDeal, B extends AnyBoard<D>>(board: B, event: RemoteDeal): B {
  const deal = findDeal(board, event.dealId);
  if (!deal) return board;
  const stages = without(board, event.dealId).map((s) => {
    if (s.id !== event.stageId || event.status !== 'open') return s;
    const moved = { ...deal, stageId: event.stageId, position: event.position };
    return { ...s, deals: [...s.deals, moved].sort((a, b) => a.position - b.position) };
  });
  return { ...board, stages };
}
