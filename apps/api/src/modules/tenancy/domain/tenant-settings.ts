import { z } from 'zod';
import type { BusinessHours } from '../../../shared/database/schema.js';

/** Idiomas con traducción disponible o planificada (E14-S02). */
export const SUPPORTED_LOCALES = ['es-CO', 'es-MX', 'es-PE', 'es-CL', 'es-AR', 'pt-BR'] as const;

export const DEFAULT_OUT_OF_HOURS_MESSAGE =
  'Gracias por escribirnos. En este momento estamos fuera de horario; te responderemos apenas abramos.';

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  mon: [{ from: '08:00', to: '18:00' }],
  tue: [{ from: '08:00', to: '18:00' }],
  wed: [{ from: '08:00', to: '18:00' }],
  thu: [{ from: '08:00', to: '18:00' }],
  fri: [{ from: '08:00', to: '18:00' }],
  sat: [{ from: '08:00', to: '13:00' }],
  sun: [],
};

const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const isoCurrencies = new Set(Intl.supportedValuesOf('currency'));

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Formato HH:mm');

const daySchedule = z
  .array(z.object({ from: time, to: time }))
  .max(3)
  .refine((ranges) => ranges.every((r) => r.from < r.to), 'Cada franja debe terminar después de empezar')
  .refine(
    (ranges) => [...ranges].sort((a, b) => a.from.localeCompare(b.from)).every((r, i, s) => i === 0 || s[i - 1]!.to <= r.from),
    'Las franjas no pueden superponerse',
  );

export const updateTenantSettingsSchema = z
  .object({
    timezone: z.string().refine(isValidTimeZone, 'Zona horaria inválida'),
    currency: z.string().toUpperCase().refine((c) => isoCurrencies.has(c), 'Moneda ISO 4217 inválida'),
    locale: z.enum(SUPPORTED_LOCALES),
    businessHours: z.object({
      mon: daySchedule, tue: daySchedule, wed: daySchedule, thu: daySchedule,
      fri: daySchedule, sat: daySchedule, sun: daySchedule,
    }),
    sellersSeeOnlyAssigned: z.boolean(),
    outOfHoursEnabled: z.boolean(),
    outOfHoursMessage: z.string().trim().min(1).max(1000),
  })
  .partial()
  .strict();

export type UpdateTenantSettings = z.infer<typeof updateTenantSettingsSchema>;
