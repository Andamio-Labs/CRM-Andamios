import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface Keyring {
  activeKeyId: string;
  keys: Record<string, Buffer>;
}

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const TAG_BYTES = 16;

/**
 * E13-S05 — Cifrado autenticado de secretos en reposo.
 *
 * Formato: `v1:<keyId>:<iv>:<tag>:<ciphertext>` (base64url).
 * - IV aleatorio de 96 bits por mensaje.
 * - `context` va como AAD: atamos el cifrado a su dueño (p. ej. "tenantId:nombre").
 *   Un cifrado copiado a otro tenant o a otro campo NO descifra.
 * - keyId permite rotar: se cifra con la activa, se descifra con cualquiera del keyring.
 *
 * En la nube el keyring sale de KMS/Secrets Manager; en local, de ENCRYPTION_KEYS.
 */
export class SecretBox {
  constructor(private readonly ring: Keyring) {
    for (const [id, key] of Object.entries(ring.keys)) {
      if (key.length !== 32) throw new Error(`La clave "${id}" debe tener 32 bytes (AES-256)`);
    }
    if (!ring.keys[ring.activeKeyId]) throw new Error(`La clave activa "${ring.activeKeyId}" no está en el keyring`);
  }

  encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.ring.keys[this.ring.activeKeyId]!, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [VERSION, this.ring.activeKeyId, iv, cipher.getAuthTag(), body]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join(':');
  }

  decrypt(encrypted: string, context: string): string {
    const [version, keyId, iv, tag, body] = encrypted.split(':');
    if (version !== VERSION || !keyId || !iv || !tag || body === undefined) throw new Error('Formato de secreto inválido');
    const key = this.ring.keys[keyId];
    if (!key) throw new Error(`No existe la clave "${keyId}" en el keyring: no se puede descifrar`);

    // Tag de 128 bits obligatorio: Node acepta tags truncados, y uno de 4 bytes se falsifica por fuerza bruta.
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'), { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  }

  /** true si fue cifrado con una clave que ya no es la activa (candidato a re-cifrar). */
  needsRotation(encrypted: string): boolean {
    return encrypted.split(':')[1] !== this.ring.activeKeyId;
  }
}

/** "k1:<base64>,k2:<base64>" → Keyring. */
export function parseKeyring(raw: string, activeKeyId: string): Keyring {
  const keys: Record<string, Buffer> = {};
  for (const entry of raw.split(',').map((e) => e.trim()).filter(Boolean)) {
    const [id, value] = entry.split(':');
    if (!id || !value) throw new Error('ENCRYPTION_KEYS debe tener el formato "id:base64,id:base64"');
    keys[id] = Buffer.from(value, 'base64');
  }
  if (!keys[activeKeyId]) throw new Error(`ENCRYPTION_ACTIVE_KEY "${activeKeyId}" no está en ENCRYPTION_KEYS`);
  return { activeKeyId, keys };
}
