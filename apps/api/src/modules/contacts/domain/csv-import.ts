import type { CountryCode } from 'libphonenumber-js';
import { z } from 'zod';
import type { CustomFieldValues } from '../../../shared/database/schema.js';
import { type FieldDefinition, validateCustomFieldValues } from './custom-fields.js';
import { normalizePhone } from './phone.js';

export const MAX_IMPORT_ROWS = 50_000;

/** Destinos posibles de una columna del CSV. '' = ignorar la columna. */
export const IMPORT_TARGETS = ['name', 'phone', 'email', 'tags', 'notes', 'source', 'priority', 'kind'] as const;

const SYNONYMS: Record<(typeof IMPORT_TARGETS)[number], string[]> = {
  name: ['nombre', 'nombre completo', 'name', 'cliente', 'contacto'],
  phone: ['telefono', 'celular', 'movil', 'whatsapp', 'phone', 'tel'],
  email: ['email', 'e-mail', 'correo', 'correo electronico', 'mail'],
  tags: ['etiquetas', 'tags', 'etiqueta'],
  notes: ['notas', 'nota', 'observaciones', 'notes'],
  source: ['origen', 'fuente', 'source', 'canal'],
  priority: ['prioridad', 'priority'],
  kind: ['tipo', 'tipo de cliente', 'kind'],
};

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function suggestMapping(headers: string[], customKeys: string[]): Record<string, string> {
  return Object.fromEntries(headers.map((h) => {
    const n = norm(h);
    const target = IMPORT_TARGETS.find((t) => SYNONYMS[t].includes(n)) ?? (customKeys.includes(n) ? `custom.${n}` : '');
    return [h, target];
  }));
}

const PRIORITIES: Record<string, string> = { critica: 'critical', critical: 'critical', alta: 'high', high: 'high', media: 'medium', medium: 'medium', baja: 'low', low: 'low' };
const KINDS: Record<string, string> = { persona: 'person', person: 'person', 'persona natural': 'person', empresa: 'company', company: 'company', 'persona juridica': 'company' };

export interface ImportValues {
  name: string;
  phone?: string;
  email?: string;
  tags?: string[];
  notes?: string;
  source?: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  kind?: 'person' | 'company';
  customFields?: CustomFieldValues;
}

/** Una fila del CSV → valores de contacto, o un motivo legible para el reporte de errores. */
export function mapRow(
  row: Record<string, string | undefined>,
  mapping: Record<string, string>,
  ctx: { defs: FieldDefinition[]; country: CountryCode },
): { ok: true; values: ImportValues } | { ok: false; error: string } {
  const get = (target: string) => {
    const column = Object.keys(mapping).find((c) => mapping[c] === target);
    return column ? (row[column] ?? '').trim() : '';
  };
  try {
    const name = get('name');
    if (!name) return { ok: false, error: 'Falta el nombre' };
    const values: ImportValues = { name: name.slice(0, 160) };

    const phone = get('phone');
    if (phone) values.phone = normalizePhone(phone, ctx.country);
    const email = get('email');
    if (email) {
      const parsed = z.email().safeParse(email.toLowerCase());
      if (!parsed.success) return { ok: false, error: `Correo inválido: ${email}` };
      values.email = parsed.data;
    }
    const tags = get('tags');
    if (tags) values.tags = [...new Set(tags.split(/[;,]/).map((t) => t.trim()).filter(Boolean))].slice(0, 30);
    const notes = get('notes');
    if (notes) values.notes = notes.slice(0, 5000);
    const source = get('source');
    if (source) values.source = source.slice(0, 60);
    const priority = get('priority');
    if (priority) {
      const p = PRIORITIES[norm(priority)];
      if (!p) return { ok: false, error: `Prioridad desconocida: ${priority}` };
      values.priority = p as ImportValues['priority'];
    }
    const kind = get('kind');
    if (kind) values.kind = (KINDS[norm(kind)] ?? 'person') as ImportValues['kind'];

    const custom = Object.fromEntries(
      Object.entries(mapping).filter(([, t]) => t.startsWith('custom.')).map(([col, t]) => [t.slice(7), (row[col] ?? '').trim()]).filter(([, v]) => v),
    );
    if (Object.keys(custom).length) {
      const typed = Object.fromEntries((Object.entries(custom) as [string, string][]).map(([k, v]) => {
        const def = ctx.defs.find((d) => d.key === k);
        if (def?.type === 'number' || def?.type === 'currency') return [k, Number(v.replace(/\./g, '').replace(',', '.'))];
        if (def?.type === 'multiselect') return [k, v.split(/[;,]/).map((x: string) => x.trim())];
        return [k, v];
      }));
      values.customFields = validateCustomFieldValues(ctx.defs, typed);
    }
    return { ok: true, values };
  } catch (error) {
    const message = (error as Error).message;
    return { ok: false, error: message.includes('teléfono') ? message : `Dato inválido: ${message}` };
  }
}
