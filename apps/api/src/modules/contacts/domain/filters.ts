import { and, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FieldDefinition } from './custom-fields.js';

/**
 * E02-S06 — Filtros combinables. El JSON del usuario NUNCA llega como texto al SQL:
 * campos y operadores salen de una whitelist por tipo, y los valores van parametrizados.
 */
export const filterSchema = z.object({
  match: z.enum(['all', 'any']).default('all'),
  conditions: z
    .array(
      z.object({
        field: z.string().max(60),
        op: z.string().max(20),
        value: z.union([z.string().max(200), z.number(), z.array(z.string().max(200)).max(50)]).optional(),
      }),
    )
    .max(20),
});
export type Filter = z.infer<typeof filterSchema>;

export class InvalidFilterError extends Error {}

type Kind = 'text' | 'tags' | 'id' | 'date' | 'number' | 'select' | 'multiselect';

/** Campo filtrable: tipo + expresión SQL de la columna. */
export type FieldCatalog = Record<string, { kind: Kind; column: SQL }>;

const OPS: Record<Kind, readonly string[]> = {
  text: ['eq', 'contains', 'empty', 'notEmpty'],
  tags: ['has', 'hasAny', 'notHas', 'empty'],
  id: ['eq', 'in', 'empty'],
  date: ['eq', 'gte', 'lte'],
  number: ['eq', 'gt', 'gte', 'lt', 'lte'],
  select: ['eq', 'in', 'empty'],
  multiselect: ['has', 'empty'],
};

/** Escapa los comodines de LIKE: buscar "50%" no debe significar "50 seguido de cualquier cosa". */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export function normalizedContains(column: SQL, value: string): SQL {
  return sql`lower(f_unaccent(${column})) LIKE '%' || lower(f_unaccent(${escapeLike(value)})) || '%'`;
}

function customField(def: FieldDefinition, jsonColumn: SQL): { kind: Kind; column: SQL } {
  const text = sql`(${jsonColumn} ->> ${def.key})`;
  switch (def.type) {
    case 'number':
    case 'currency':
      return { kind: 'number', column: sql`(${text})::numeric` };
    case 'date':
      return { kind: 'date', column: sql`(${text})::date` };
    case 'select':
      return { kind: 'select', column: text };
    case 'multiselect':
      return { kind: 'multiselect', column: sql`(${jsonColumn} -> ${def.key})` };
    default:
      return { kind: 'text', column: text };
  }
}

export function compileFilter(filter: Filter, catalog: FieldCatalog, customDefs: FieldDefinition[], jsonColumn: SQL): SQL | undefined {
  const parts = filter.conditions.map(({ field, op, value }) => {
    const target = field.startsWith('custom.')
      ? (() => {
          const def = customDefs.find((d) => d.key === field.slice('custom.'.length));
          return def ? customField(def, jsonColumn) : undefined;
        })()
      : Object.hasOwn(catalog, field) ? catalog[field] : undefined;
    if (!target) throw new InvalidFilterError(`No se puede filtrar por "${field}"`);
    if (!OPS[target.kind].includes(op)) throw new InvalidFilterError(`"${op}" no aplica a "${field}"`);
    return condition(target.kind, target.column, op, value, field);
  });
  if (!parts.length) return undefined;
  return filter.match === 'any' ? or(...parts) : and(...parts);
}

function condition(kind: Kind, col: SQL, op: string, value: unknown, field: string): SQL {
  const str = () => {
    if (typeof value !== 'string' || !value.length) throw new InvalidFilterError(`"${field}" necesita un texto`);
    return value;
  };
  const num = () => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new InvalidFilterError(`"${field}" necesita un número`);
    return value;
  };
  const list = () => {
    if (!Array.isArray(value) || !value.length) throw new InvalidFilterError(`"${field}" necesita una lista`);
    return value as string[];
  };
  const date = () => {
    const v = str();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new InvalidFilterError(`"${field}" necesita una fecha AAAA-MM-DD`);
    return v;
  };

  if (op === 'empty') {
    if (kind === 'tags') return sql`cardinality(${col}) = 0`;
    if (kind === 'multiselect') return sql`coalesce(jsonb_array_length(${col}), 0) = 0`;
    return sql`(${col} IS NULL OR ${col}::text = '')`;
  }
  if (op === 'notEmpty') return sql`(${col} IS NOT NULL AND ${col}::text <> '')`;

  switch (kind) {
    case 'text':
      return op === 'contains' ? normalizedContains(col, str()) : sql`lower(${col}) = lower(${str()})`;
    case 'tags':
      if (op === 'has') return sql`${col} @> ARRAY[${str()}]::text[]`;
      if (op === 'notHas') return sql`NOT (${col} @> ARRAY[${str()}]::text[])`;
      return sql`${col} && ${list()}::text[]`;
    case 'id':
    case 'select':
      return op === 'in' ? sql`${col} = ANY(${list()}::text[])` : sql`${col} = ${str()}`;
    case 'multiselect':
      return sql`coalesce(${col}, '[]'::jsonb) @> ${JSON.stringify([str()])}::jsonb`;
    case 'date': {
      const v = date();
      return op === 'gte' ? sql`${col} >= ${v}::date` : op === 'lte' ? sql`${col} <= ${v}::date` : sql`${col} = ${v}::date`;
    }
    case 'number': {
      const v = num();
      const cmp = { eq: sql`=`, gt: sql`>`, gte: sql`>=`, lt: sql`<`, lte: sql`<=` }[op as 'eq'];
      return sql`${col} ${cmp} ${v}`;
    }
  }
}
