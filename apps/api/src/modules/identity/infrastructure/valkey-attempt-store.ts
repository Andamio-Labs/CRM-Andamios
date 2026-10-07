import type { OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { AttemptStore } from '../domain/login-throttle.js';

/** Adaptador de runtime: compartido entre réplicas de la API, con vencimiento nativo. */
export class ValkeyAttemptStore implements AttemptStore, OnApplicationShutdown {
  constructor(private readonly redis: Redis) {}

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const [[, count]] = (await this.redis.multi().incr(key).expire(key, ttlSeconds).exec()) as [[null, number]];
    return count;
  }

  async get(key: string): Promise<number> {
    return Number((await this.redis.get(key)) ?? 0);
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async onApplicationShutdown() {
    await this.redis.quit();
  }
}
