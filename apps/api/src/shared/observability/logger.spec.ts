import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACT_PATHS } from './logger.js';

/** E15-S03 + E13 — Los logs estructurados nunca contienen credenciales. */
describe('Redacción de logs', () => {
  function capture(obj: object): string {
    let out = '';
    const stream = new Writable({ write: (chunk, _, done) => ((out += chunk), done()) });
    pino({ redact: { paths: REDACT_PATHS, censor: '[REDACTADO]' } }, stream).info(obj, 'test');
    return out;
  }

  it.each([
    ['cookie de sesión', { req: { headers: { cookie: 'better-auth.session_token=abc123' } } }, 'abc123'],
    ['authorization', { req: { headers: { authorization: 'Bearer secreto' } } }, 'secreto'],
    ['set-cookie', { res: { headers: { 'set-cookie': 'session=xyz789' } } }, 'xyz789'],
    ['password en body', { body: { password: 'Colombia2026!' } }, 'Colombia2026!'],
    ['token en body', { body: { token: 'tok-reset-1' } }, 'tok-reset-1'],
    ['newPassword', { body: { newPassword: 'Nueva2026!!' } }, 'Nueva2026!!'],
  ])('oculta %s', (_, obj, secret) => {
    const line = capture(obj);
    expect(line).not.toContain(secret);
    expect(line).toContain('[REDACTADO]');
  });
});
