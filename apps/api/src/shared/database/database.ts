import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Conecta con el rol de la APP (beecrm_app): sujeto a RLS siempre. */
export function createDatabase(connectionString: string): { db: Database; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return { db: drizzle(pool, { schema }), pool };
}
