import type { CustomFieldType, CustomFieldValues } from '../../../shared/database/schema.js';

export const MAX_CUSTOM_FIELDS_PER_ENTITY = 50;

export interface FieldDefinition {
  key: string;
  label: string;
  type: CustomFieldType;
  options: string[];
}

export class InvalidCustomFieldError extends Error {}

const isIsoDate = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
};

/**
 * E02-S04 — Valida y normaliza valores contra las definiciones del tenant.
 * null borra el valor. Una clave sin definición es un error (no guardamos basura en el JSON).
 */
export function validateCustomFieldValues(definitions: FieldDefinition[], values: Record<string, unknown>): CustomFieldValues {
  const byKey = new Map(definitions.map((d) => [d.key, d]));
  const out: CustomFieldValues = {};
  for (const [key, raw] of Object.entries(values)) {
    const def = byKey.get(key);
    if (!def) throw new InvalidCustomFieldError(`El campo "${key}" no existe`);
    if (raw === null) {
      out[key] = null;
      continue;
    }
    const fail = (why: string): never => {
      throw new InvalidCustomFieldError(`"${def.label}": ${why}`);
    };
    switch (def.type) {
      case 'text':
        if (typeof raw !== 'string') fail('debe ser texto');
        if ((raw as string).length > 1000) fail('máximo 1000 caracteres');
        out[key] = (raw as string).trim();
        break;
      case 'number':
      case 'currency':
        if (typeof raw !== 'number' || !Number.isFinite(raw)) fail('debe ser un número');
        if (def.type === 'currency' && (raw as number) < 0) fail('no puede ser negativo');
        out[key] = raw as number;
        break;
      case 'date':
        if (typeof raw !== 'string' || !isIsoDate(raw)) fail('debe ser una fecha AAAA-MM-DD');
        out[key] = raw as string;
        break;
      case 'select':
        if (typeof raw !== 'string' || !def.options.includes(raw)) fail(`debe ser una de: ${def.options.join(', ')}`);
        out[key] = raw as string;
        break;
      case 'multiselect':
        if (!Array.isArray(raw) || !raw.every((v) => typeof v === 'string' && def.options.includes(v))) {
          fail(`debe ser una lista con opciones de: ${def.options.join(', ')}`);
        }
        out[key] = [...new Set(raw as string[])];
        break;
    }
  }
  return out;
}
