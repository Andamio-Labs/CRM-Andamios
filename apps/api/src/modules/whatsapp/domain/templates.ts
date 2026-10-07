export class InvalidTemplateError extends Error {}

/**
 * E04-S05 — Reglas de plantillas de Meta que podemos validar antes de enviarlas a aprobación:
 * nombre en minúsculas con _, cuerpo ≤ 1024, variables {{1}}..{{n}} consecutivas y no pegadas,
 * y un ejemplo por variable (Meta rechaza plantillas con variables sin ejemplo).
 */
export function validateTemplate(input: { name: string; body: string; examples: string[] }): { variables: number } {
  if (!/^[a-z0-9_]{1,512}$/.test(input.name)) throw new InvalidTemplateError('El nombre solo admite minúsculas, números y _');
  if (!input.body.trim() || input.body.length > 1024) throw new InvalidTemplateError('El cuerpo debe tener entre 1 y 1024 caracteres');
  if (/\}\}\s*\{\{/.test(input.body)) throw new InvalidTemplateError('Dos variables no pueden ir pegadas');

  const used = usedVariables(input.body);
  const variables = countVariables(input.body);
  for (let i = 1; i <= variables; i++) {
    if (!used.includes(i)) throw new InvalidTemplateError(`Falta la variable {{${i}}}: deben ser consecutivas`);
  }
  if (input.examples.length !== variables) throw new InvalidTemplateError(`Se necesitan ${variables} ejemplos, uno por variable`);
  return { variables };
}

const usedVariables = (body: string) => [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));

/** Cantidad de variables = el número más alto usado ({{1}}..{{n}}). */
export function countVariables(body: string): number {
  const used = usedVariables(body);
  return used.length ? Math.max(...used) : 0;
}

/** Parámetros del cuerpo en el formato de la Cloud API. */
export function templateComponents(values: string[]) {
  return values.length ? [{ type: 'body', parameters: values.map((text) => ({ type: 'text', text })) }] : [];
}

export function renderTemplate(body: string, values: string[]) {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => values[Number(n) - 1] ?? `{{${n}}}`);
}
