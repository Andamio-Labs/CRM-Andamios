/**
 * E07-S01 — Reparto por turnos: el siguiente después del último asignado (lista estable, ordenada).
 * E01-S09 — Salta a quien no está disponible sin perder el orden de la ronda.
 */
export function nextAssignee(candidates: string[], lastAssigned: string | null, isAvailable: (id: string) => boolean = () => true): string | null {
  const start = lastAssigned ? candidates.indexOf(lastAssigned) : -1;
  for (let step = 1; step <= candidates.length; step++) {
    const candidate = candidates[(start + step) % candidates.length]!;
    if (isAvailable(candidate)) return candidate;
  }
  return null;
}
