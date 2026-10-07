import type { AttemptStore } from '../domain/login-throttle.js';

/** Adaptador para tests. `now` inyectable para controlar el tiempo sin esperar. */
export class InMemoryAttemptStore implements AttemptStore {
  private readonly entries = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const count = (await this.get(key)) + 1;
    this.entries.set(key, { count, expiresAt: this.now() + ttlSeconds * 1000 });
    return count;
  }

  async get(key: string): Promise<number> {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= this.now()) return 0;
    return entry.count;
  }

  async reset(key: string): Promise<void> {
    this.entries.delete(key);
  }
}
