/**
 * Genera el SQL de las tablas de Better Auth (user, session, account, verification,
 * organization, member, invitation) contra una base VACÍA y lo imprime por stdout.
 *
 *   node scripts/generate-auth-sql.ts > migrations/0001_better_auth.sql
 *
 * Los plugins deben coincidir con src/modules/identity/infrastructure/auth.ts.
 * Si se desincronizan, el test `auth-schema-drift.spec.ts` falla.
 */
import { getMigrations } from 'better-auth/db/migration';
import { organization } from 'better-auth/plugins';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_OWNER_URL ?? 'postgres://beecrm_owner:beecrm_owner@localhost:5442/beecrm',
});
const options = { database: pool, emailAndPassword: { enabled: true }, plugins: [organization()] };
const { compileMigrations } = await getMigrations(options);
console.log(await compileMigrations());
await pool.end();
