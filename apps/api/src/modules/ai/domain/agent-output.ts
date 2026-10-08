import { z } from 'zod';

const schema = z.object({
  reply: z.string().max(2000).default(''),
  handoff: z.boolean().default(false),
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).default({}),
});

export type AgentOutput = z.infer<typeof schema>;

/**
 * E05-S03 — El modelo responde en JSON: el texto para el cliente, si hay que pasar a una persona y
 * los datos que el cliente dio. Una salida que no cumple el formato NO se envía (se escala).
 */
export function parseAgentOutput(text: string): AgentOutput | null {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return null;
  const output = { ...parsed.data, reply: parsed.data.reply.trim() };
  return output.reply || output.handoff ? output : null;
}
