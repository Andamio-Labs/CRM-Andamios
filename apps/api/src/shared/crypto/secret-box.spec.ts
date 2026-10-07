import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseKeyring, SecretBox } from './secret-box.js';

/** E13-S05 — Cifrado de secretos en reposo (tokens de Meta, etc.). */
describe('SecretBox (AES-256-GCM)', () => {
  const k1 = randomBytes(32);
  const k2 = randomBytes(32);
  const box = new SecretBox({ activeKeyId: 'k1', keys: { k1 } });
  const ctx = 'tenant-a:whatsapp.access_token';

  it('cifra y descifra', () => {
    expect(box.decrypt(box.encrypt('EAAG-token-secreto', ctx), ctx)).toBe('EAAG-token-secreto');
  });

  it('el texto cifrado no contiene el secreto y cambia en cada cifrado (IV aleatorio)', () => {
    const a = box.encrypt('EAAG-token-secreto', ctx);
    const b = box.encrypt('EAAG-token-secreto', ctx);
    expect(a).not.toContain('EAAG');
    expect(a).not.toBe(b);
    expect(a.startsWith('v1:k1:')).toBe(true);
  });

  it('detecta alteraciones (integridad GCM)', () => {
    const parts = box.encrypt('EAAG-token-secreto', ctx).split(':');
    const body = Buffer.from(parts[4]!, 'base64url');
    body[0]! ^= 0xff;
    parts[4] = body.toString('base64url');
    expect(() => box.decrypt(parts.join(':'), ctx)).toThrow();
  });

  it('no descifra con otro contexto: copiar el secreto a otro tenant no sirve', () => {
    const encrypted = box.encrypt('EAAG-token-secreto', ctx);
    expect(() => box.decrypt(encrypted, 'tenant-b:whatsapp.access_token')).toThrow();
  });

  it('rotación: cifra con la clave activa y sigue descifrando con las anteriores', () => {
    const old = box.encrypt('viejo', ctx);
    const rotated = new SecretBox({ activeKeyId: 'k2', keys: { k1, k2 } });
    expect(rotated.decrypt(old, ctx)).toBe('viejo');
    expect(rotated.encrypt('nuevo', ctx).startsWith('v1:k2:')).toBe(true);
    expect(rotated.needsRotation(old)).toBe(true);
  });

  it('falla claro si la clave del mensaje ya no existe', () => {
    const encrypted = box.encrypt('x', ctx);
    expect(() => new SecretBox({ activeKeyId: 'k2', keys: { k2 } }).decrypt(encrypted, ctx)).toThrow(/k1/);
  });

  it('exige claves de 256 bits', () => {
    expect(() => new SecretBox({ activeKeyId: 'k', keys: { k: randomBytes(16) } })).toThrow(/32 bytes/);
  });
});

describe('parseKeyring', () => {
  it('lee "id:base64,id:base64" y valida la clave activa', () => {
    const raw = `k1:${randomBytes(32).toString('base64')},k2:${randomBytes(32).toString('base64')}`;
    const ring = parseKeyring(raw, 'k2');
    expect(Object.keys(ring.keys)).toEqual(['k1', 'k2']);
    expect(() => parseKeyring(raw, 'k9')).toThrow(/k9/);
  });
});
