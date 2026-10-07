import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * E04-S02 — Meta firma el body CRUDO con HMAC-SHA256 usando el App Secret.
 * Se compara en tiempo constante; cualquier formato raro es inválido.
 */
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const received = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}
