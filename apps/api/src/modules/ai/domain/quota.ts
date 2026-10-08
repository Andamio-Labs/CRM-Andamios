/** E05-S06 — Estado de la cuota mensual de respuestas de IA. Se avisa al 80 % y al 100 %. */
export function quotaState(used: number, limit: number) {
  const percent = limit > 0 ? Math.floor((used / limit) * 100) : 100;
  const threshold = percent >= 100 ? 100 : percent >= 80 ? 80 : null;
  return { used, limit, percent, threshold: threshold as 80 | 100 | null, exhausted: used >= limit };
}
