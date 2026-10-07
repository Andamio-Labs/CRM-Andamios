import { type CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js/max';

/** Países donde opera BeeCRM (E02-S01: Colombia y LatAm). */
export const LATAM_COUNTRIES = new Set<CountryCode>([
  'CO', 'MX', 'PE', 'CL', 'AR', 'EC', 'BR', 'PA', 'CR', 'GT', 'UY', 'PY', 'BO', 'VE', 'DO', 'SV', 'HN', 'NI', 'PR',
]);

export class InvalidPhoneError extends Error {}

/**
 * Normaliza a E.164 (+573001234567). Sin prefijo internacional se asume el país del tenant.
 * Usa la metadata "max" de libphonenumber: valida rangos reales, no solo largo.
 */
export function normalizePhone(input: string, defaultCountry: CountryCode = 'CO'): string {
  const phone = parsePhoneNumberFromString(input, defaultCountry);
  if (!phone?.isValid()) throw new InvalidPhoneError(`"${input}" no es un teléfono válido`);
  if (!phone.country || !LATAM_COUNTRIES.has(phone.country)) {
    throw new InvalidPhoneError(`"${input}" no es un teléfono de Latinoamérica`);
  }
  return phone.number;
}

/** "es-CO" → "CO". */
export function countryFromLocale(locale: string): CountryCode {
  const country = locale.split('-')[1]?.toUpperCase() as CountryCode | undefined;
  return country && LATAM_COUNTRIES.has(country) ? country : 'CO';
}
