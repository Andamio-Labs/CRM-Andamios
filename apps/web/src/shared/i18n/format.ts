export interface RegionalSettings {
  locale: string;
  currency: string;
  timeZone: string;
}

/**
 * E14-S02 — Formatos por país del tenant (no del navegador): un vendedor en Madrid que atiende
 * una empresa de Bogotá ve horas y pesos de Bogotá.
 */
export function createFormatters({ locale, currency, timeZone }: RegionalSettings) {
  const moneyFormat = (code: string) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: code, maximumFractionDigits: code === 'COP' || code === 'CLP' ? 0 : 2 });
  const dateFormat = new Intl.DateTimeFormat(locale, { timeZone, day: 'numeric', month: 'numeric', year: 'numeric' });
  const timeFormat = new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' });

  return {
    money: (value: number, code = currency) => moneyFormat(code).format(value),
    date: (value: Date | string) => dateFormat.format(new Date(value)),
    time: (value: Date | string) => timeFormat.format(new Date(value)),
  };
}

export type Formatters = ReturnType<typeof createFormatters>;

export const DEFAULT_REGION: RegionalSettings = { locale: 'es-CO', currency: 'COP', timeZone: 'America/Bogota' };
