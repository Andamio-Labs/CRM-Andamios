import { createHash, timingSafeEqual } from 'node:crypto';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Firma de integridad de una transacción: SHA256(referencia + monto en centavos + moneda + secreto de integridad). */
export function integritySignature(tx: { reference: string; amountInCents: number; currency: string }, integritySecret: string): string {
  return sha256(`${tx.reference}${tx.amountInCents}${tx.currency}${integritySecret}`);
}

/**
 * Checksum de un evento: SHA256(valores de `signature.properties` en orden + timestamp + secreto de eventos).
 * Las propiedades son rutas dentro de `data` ("transaction.id"); solo se siguen claves propias.
 */
export function verifyEventChecksum(event: unknown, eventsSecret: string): boolean {
  const e = event as { data?: unknown; signature?: { properties?: unknown; checksum?: unknown }; timestamp?: unknown };
  const properties = e?.signature?.properties;
  const checksum = e?.signature?.checksum;
  if (!Array.isArray(properties) || !properties.length || typeof checksum !== 'string' || !Number.isInteger(e.timestamp)) return false;

  let concatenated = '';
  for (const path of properties) {
    if (typeof path !== 'string') return false;
    const value = path.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' && Object.hasOwn(node, key) ? (node as Record<string, unknown>)[key] : undefined), e.data);
    if (value === undefined || value === null || typeof value === 'object') return false;
    concatenated += String(value);
  }
  const expected = Buffer.from(sha256(`${concatenated}${e.timestamp}${eventsSecret}`));
  const received = Buffer.from(checksum.toLowerCase());
  return expected.length === received.length && timingSafeEqual(expected, received);
}
