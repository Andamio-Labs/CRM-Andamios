import { describe, expect, it } from 'vitest';
import { InMemoryAttemptStore } from '../infrastructure/in-memory-attempt-store.js';
import { LoginThrottle } from './login-throttle.js';

/** E01-S02 — Bloqueo temporal tras 5 intentos fallidos. */
describe('LoginThrottle', () => {
  const build = () => new LoginThrottle(new InMemoryAttemptStore(), { maxAttempts: 5, lockSeconds: 900 });

  it('no bloquea con menos de 5 fallos', async () => {
    const throttle = build();
    for (let i = 0; i < 4; i++) await throttle.registerFailure('ana@empresa.co');
    expect(await throttle.isLocked('ana@empresa.co')).toBe(false);
  });

  it('bloquea al quinto fallo', async () => {
    const throttle = build();
    for (let i = 0; i < 5; i++) await throttle.registerFailure('ana@empresa.co');
    expect(await throttle.isLocked('ana@empresa.co')).toBe(true);
  });

  it('normaliza el correo: mayúsculas y espacios cuentan como la misma cuenta', async () => {
    const throttle = build();
    for (let i = 0; i < 5; i++) await throttle.registerFailure(i % 2 ? ' ANA@empresa.co ' : 'ana@EMPRESA.co');
    expect(await throttle.isLocked('ana@empresa.co')).toBe(true);
  });

  it('un login exitoso reinicia el contador', async () => {
    const throttle = build();
    for (let i = 0; i < 4; i++) await throttle.registerFailure('ana@empresa.co');
    await throttle.registerSuccess('ana@empresa.co');
    await throttle.registerFailure('ana@empresa.co');
    expect(await throttle.isLocked('ana@empresa.co')).toBe(false);
  });

  it('el bloqueo es temporal: vence después de lockSeconds', async () => {
    let now = 0;
    const throttle = new LoginThrottle(new InMemoryAttemptStore(() => now), { maxAttempts: 5, lockSeconds: 900 });
    for (let i = 0; i < 5; i++) await throttle.registerFailure('ana@empresa.co');
    now += 899_000;
    expect(await throttle.isLocked('ana@empresa.co')).toBe(true);
    now += 2_000;
    expect(await throttle.isLocked('ana@empresa.co')).toBe(false);
  });

  it('las cuentas no se afectan entre sí', async () => {
    const throttle = build();
    for (let i = 0; i < 5; i++) await throttle.registerFailure('ana@empresa.co');
    expect(await throttle.isLocked('luis@empresa.co')).toBe(false);
  });
});
