export interface DealEvent {
  type: string;
  data: Record<string, unknown>;
  actorId: string | null;
  createdAt: string;
}

/** Días completos desde que el negocio entró a su etapa actual (alerta de estancado). */
export function daysInStage(stageEnteredAt: string, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(stageEnteredAt)) / 86_400_000));
}

/** Una línea del historial del negocio, en el idioma del vendedor. */
export function describeEvent(event: DealEvent, stageName: (id: unknown) => string): string {
  const d = event.data;
  switch (event.type) {
    case 'created': return `Se creó en ${stageName(d.stageId)}`;
    case 'stage_changed': return `Pasó de ${stageName(d.from)} a ${stageName(d.to)}${d.robotId ? ' (lo movió un robot)' : ''}`;
    case 'won': return `Ganado${d.reason ? `: ${String(d.reason)}` : ''}${d.note ? ` — ${String(d.note)}` : ''}`;
    case 'lost': return `Perdido${d.reason ? `: ${String(d.reason)}` : ''}${d.note ? ` — ${String(d.note)}` : ''}`;
    case 'reopened': return 'Se reabrió';
    case 'claimed': return 'Lo tomó del pool de leads';
    default: return event.type;
  }
}
