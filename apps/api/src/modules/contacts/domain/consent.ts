/**
 * E13-S02 — Consentimiento y finalidad (Ley 1581 de 2012).
 * Base legal: la autorización del titular o una de las excepciones del art. 10 que aplican a un CRM.
 */
export const LEGAL_BASES = ['consent', 'contract', 'legal_obligation', 'public_data'] as const;
export const PURPOSES = ['sales', 'customer_service', 'marketing', 'billing'] as const;
export const CONSENT_CHANNELS = ['whatsapp', 'web_form', 'phone', 'email', 'in_person', 'import'] as const;

export type Purpose = (typeof PURPOSES)[number];

interface ConsentRecord {
  purposes: readonly Purpose[];
  granted: boolean;
  recordedAt: Date;
}

/** Estado actual por finalidad: gana el registro más reciente que la menciona. */
export function currentConsents<T extends ConsentRecord>(history: readonly T[]): Partial<Record<Purpose, T>> {
  const current: Partial<Record<Purpose, T>> = {};
  for (const record of history) {
    for (const purpose of record.purposes) {
      const seen = current[purpose];
      if (!seen || seen.recordedAt < record.recordedAt) current[purpose] = record;
    }
  }
  return current;
}
