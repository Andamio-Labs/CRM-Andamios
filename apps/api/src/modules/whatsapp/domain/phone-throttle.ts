import type { AttemptStore } from '../../identity/domain/login-throttle.js';

export class ThrottledError extends Error {
  constructor(readonly phoneNumberId: string) {
    super(`Límite de envío por segundo alcanzado para ${phoneNumberId}`);
  }
}

/**
 * E15-S06 — Ritmo de envío por número (ventana de 1 s, compartida entre workers vía Valkey).
 * La Cloud API admite ~80 msg/s por número; vamos por debajo para no gatillar 130429.
 */
export class PhoneThrottle {
  constructor(
    private readonly store: AttemptStore,
    private readonly perSecond = 60,
    private readonly now: () => number = Date.now,
  ) {}

  async acquire(phoneNumberId: string): Promise<void> {
    const second = Math.floor(this.now() / 1000);
    const used = await this.store.increment(`wa-rate:${phoneNumberId}:${second}`, 2);
    if (used > this.perSecond) throw new ThrottledError(phoneNumberId);
  }
}
