import { getMigrations } from 'better-auth/db/migration';
import pg from 'pg';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { createAuth } from '../src/modules/identity/infrastructure/auth.js';
import { InMemoryMailer } from '../src/shared/mail/in-memory-mailer.js';

/**
 * Si cambiás plugins/campos de Better Auth y no regenerás migrations/0001_better_auth.sql,
 * este test falla. Regenerar: node scripts/generate-auth-sql.ts (contra una base vacía).
 */
describe('Esquema de Better Auth sincronizado con /migrations', () => {
  const pool = new pg.Pool({ connectionString: inject('databaseOwnerUrl') });
  afterAll(() => pool.end());

  it('no hay tablas ni columnas pendientes', async () => {
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'unused', BETTER_AUTH_SECRET: 'x'.repeat(32), QUEUE_DRIVER: 'inline' });
    const auth = createAuth({ pool, env, mailer: new InMemoryMailer() });
    const { toBeCreated, toBeAdded } = await getMigrations(auth.options);
    expect(toBeCreated.map((t) => t.table)).toEqual([]);
    expect(toBeAdded.map((t) => t.table)).toEqual([]);
  });
});
