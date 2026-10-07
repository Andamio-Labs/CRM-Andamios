/** E07-S01 — Reparto por turnos: el siguiente después del último asignado (lista estable, ordenada). */
export function nextAssignee(candidates: string[], lastAssigned: string | null): string | null {
  if (!candidates.length) return null;
  const index = lastAssigned ? candidates.indexOf(lastAssigned) : -1;
  return candidates[(index + 1) % candidates.length]!;
}
