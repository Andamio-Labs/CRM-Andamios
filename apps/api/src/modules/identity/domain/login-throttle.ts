/** Puerto: dónde se cuentan los intentos fallidos (Valkey en runtime, memoria en tests). */
export interface AttemptStore {
  /** Incrementa el contador de `key` y (re)inicia su vencimiento a `ttlSeconds`. Devuelve el valor nuevo. */
  increment(key: string, ttlSeconds: number): Promise<number>;
  get(key: string): Promise<number>;
  reset(key: string): Promise<void>;
}

export interface LoginThrottlePolicy {
  maxAttempts: number;
  lockSeconds: number;
}

/**
 * E01-S02 — Bloqueo temporal tras N intentos fallidos por cuenta.
 * Cada fallo renueva la ventana: un atacante que insiste mantiene la cuenta bloqueada.
 */
export class LoginThrottle {
  constructor(
    private readonly store: AttemptStore,
    private readonly policy: LoginThrottlePolicy = { maxAttempts: 5, lockSeconds: 15 * 60 },
  ) {}

  async isLocked(email: string): Promise<boolean> {
    return (await this.store.get(this.key(email))) >= this.policy.maxAttempts;
  }

  async registerFailure(email: string): Promise<void> {
    await this.store.increment(this.key(email), this.policy.lockSeconds);
  }

  async registerSuccess(email: string): Promise<void> {
    await this.store.reset(this.key(email));
  }

  get lockMinutes(): number {
    return Math.ceil(this.policy.lockSeconds / 60);
  }

  private key(email: string): string {
    return `login-failures:${email.trim().toLowerCase()}`;
  }
}
