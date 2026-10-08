import { z } from 'zod';
import type { CustomFieldValues } from '../../../shared/database/schema.js';
import { type FieldDefinition, validateCustomFieldValues } from '../../contacts/domain/custom-fields.js';

/** E05-S04 — Campos fijos que el agente puede capturar, además de los campos personalizados. */
export const BASE_TARGETS = {
  'contact.name': 'Nombre del cliente',
  'contact.email': 'Correo electrónico',
  'deal.value': 'Presupuesto (solo el número, en la moneda de la empresa)',
  'deal.description': 'Qué necesita el cliente (su interés)',
} as const;

export const DEFAULT_QUALIFICATION = ['contact.name', 'contact.email', 'deal.description', 'deal.value'];

export interface CaptureContext {
  contact: { name: string; phone: string | null; email: string | null; customFields: CustomFieldValues };
  deal: { value: string; description: string | null; customFields: CustomFieldValues } | null;
}
export type Definitions = { contact: FieldDefinition[]; deal: FieldDefinition[] };

/** Destinos válidos para la configuración: los fijos y los campos personalizados de la empresa. */
export function qualificationTargets(defs: Definitions): { target: string; label: string }[] {
  return [
    ...Object.entries(BASE_TARGETS).map(([target, label]) => ({ target, label })),
    ...defs.contact.map((d) => ({ target: `contact.custom.${d.key}`, label: `Contacto: ${d.label}` })),
    ...defs.deal.map((d) => ({ target: `deal.custom.${d.key}`, label: `Negocio: ${d.label}` })),
  ];
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
const digits = (v: string | null) => (v ?? '').replace(/\D/g, '');

/**
 * Qué guardar de lo que dijo el cliente. Solo campos configurados, solo si están VACÍOS (nunca pisa
 * lo que cargó una persona) y solo valores válidos. El nombre "vacío" es el que quedó como el teléfono.
 */
export function planCapture(fields: Record<string, unknown>, targets: readonly string[], current: CaptureContext, defs: Definitions) {
  const contact: { name?: string; email?: string; customFields?: CustomFieldValues } = {};
  const deal: { value?: string; description?: string; customFields?: CustomFieldValues } = {};
  const captured: Record<string, unknown> = {};

  for (const [target, raw] of Object.entries(fields)) {
    if (!targets.includes(target) || isEmpty(raw)) continue;
    const text = typeof raw === 'string' ? raw.trim().slice(0, 1000) : null;

    if (target === 'contact.name') {
      const name = current.contact.name.trim();
      const nameIsPhone = !name || (digits(name).length >= 7 && digits(name) === digits(current.contact.phone));
      if (text && text.length <= 120 && nameIsPhone && /\p{L}/u.test(text)) contact.name = captured[target] = text;
    } else if (target === 'contact.email') {
      if (text && !current.contact.email && z.email().safeParse(text).success) contact.email = captured[target] = text.toLowerCase();
    } else if (target === 'deal.value') {
      const value = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d]/g, ''));
      if (current.deal && Number(current.deal.value) === 0 && Number.isFinite(value) && value > 0) {
        deal.value = String(Math.round(value));
        captured[target] = value;
      }
    } else if (target === 'deal.description') {
      if (text && current.deal && !current.deal.description) deal.description = captured[target] = text;
    } else {
      const [entity, , key] = target.split('.') as ['contact' | 'deal', string, string];
      const owner = entity === 'contact' ? current.contact : current.deal;
      if (!owner || !key || !isEmpty(owner.customFields[key])) continue;
      try {
        const valid = validateCustomFieldValues(defs[entity].filter((d) => d.key === key), { [key]: raw });
        const bucket = entity === 'contact' ? contact : deal;
        bucket.customFields = { ...owner.customFields, ...bucket.customFields, ...valid };
        captured[target] = valid[key];
      } catch {
        // Valor que no cumple el tipo del campo: se descarta.
      }
    }
  }
  return { contact, deal, captured };
}
