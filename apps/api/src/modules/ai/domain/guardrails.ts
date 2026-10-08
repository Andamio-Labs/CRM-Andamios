/**
 * E05-S07 — Guardrails del agente. Son reglas deterministas, por fuera del modelo: un LLM se puede
 * convencer de romper sus instrucciones; una expresión regular no.
 */
export const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

const luhn = (digits: string) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
};

export type Redaction = 'card' | 'secret';

/** Tapa tarjetas (con Luhn, para no confundirlas con teléfonos o cédulas), contraseñas y códigos de seguridad. */
export function redactSensitive(text: string): { text: string; redacted: Redaction[] } {
  const redacted = new Set<Redaction>();
  let out = text.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 13 || !luhn(digits)) return match;
    redacted.add('card');
    return '[tarjeta oculta]';
  });
  out = out.replace(/\b(contraseña|contrasena|clave|password|pin|cvv|cvc|c[oó]digo de seguridad)(\s*(?:es|:)\s*)(\S+)/gi, (_m, label: string, sep: string) => {
    redacted.add('secret');
    return `${label}${sep}[dato oculto]`;
  });
  return { text: out, redacted: [...redacted] };
}

const INJECTION = [
  /\b(ignora|olvida|omite|ignore|forget|disregard)\b.{0,40}\b(instrucciones|reglas|indicaciones|instructions|rules|prompt)\b/,
  /\b(revela|muestra|muestrame|dime|repite|imprime|copia|show|reveal|print|repeat)\b.{0,30}\b(prompt|instrucciones (internas|del sistema|ocultas|originales)|tus instrucciones|system prompt|configuracion interna)\b/,
  /\b(modo desarrollador|developer mode|jailbreak|sin restricciones)\b/,
  /\b(ahora eres|a partir de ahora eres|actua como si|you are now|pretend to be)\b/,
];

/** Intento de manipular al agente. Se contesta con una respuesta segura sin llamar al modelo. */
export function detectInjection(text: string): boolean {
  const folded = fold(text);
  return INJECTION.some((pattern) => pattern.test(folded));
}

export type Violation = 'prompt_leak' | 'unverified_price';

const MONEY = /(?:(?:us\$|r\$|\$|cop|usd|mxn|brl)\s?(\d[\d.,]*))|(?:(\d[\d.,]*)\s?(%|por ciento|pesos|cop|usd|mxn|dolares|reales|mil\b|millones|millon\b))/g;

/** "1.200.000", "1200000", "1,5 millones", "50 mil" → misma forma canónica para comparar. */
function canonical(number: string, unit = ''): string {
  if (unit === 'mil' || unit.startsWith('millon')) {
    const value = Number(number.replace(/\./g, '').replace(',', '.')) * (unit === 'mil' ? 1_000 : 1_000_000);
    return String(Math.round(value));
  }
  return number.replace(/[.,]/g, '').replace(/^0+(?=\d)/, '');
}

/** Precios y porcentajes de un texto, normalizados. */
function amounts(text: string): string[] {
  return [...fold(text).matchAll(MONEY)].map((m) => canonical((m[1] ?? m[2])!.replace(/[.,]$/, ''), m[3] ?? ''));
}

/** Todas las cifras de un texto (con o sin moneda): lo que el agente PUEDE citar. */
function figures(text: string): Set<string> {
  const folded = fold(text);
  const out = new Set(amounts(folded));
  for (const m of folded.matchAll(/\d[\d.,]*/g)) out.add(canonical(m[0].replace(/[.,]$/, '')));
  return out;
}

/**
 * Revisión de la respuesta antes de enviarla:
 * - `unverified_price`: cita un precio o porcentaje que no está en la base ni en lo que dijo el cliente.
 * - `prompt_leak`: repite las reglas internas.
 */
export function checkReply(reply: string, ctx: { rules: string[]; allowedText: string }): { reply: string; violations: Violation[] } {
  const violations: Violation[] = [];
  const folded = fold(reply);
  const leaks = ctx.rules.map((r) => fold(r.replace(/^-\s*/, '')).replace(/[.:]$/, '').trim()).filter((r) => r.length >= 25);
  if (folded.includes('reglas que siempre aplican') || leaks.some((rule) => folded.includes(rule))) violations.push('prompt_leak');

  const allowed = figures(ctx.allowedText);
  if (amounts(reply).some((amount) => !allowed.has(amount))) violations.push('unverified_price');

  return { reply: redactSensitive(reply).text, violations };
}
