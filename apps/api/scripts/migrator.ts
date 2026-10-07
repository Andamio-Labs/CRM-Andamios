import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

/**
 * Aplica, en orden alfabético, los .sql de `dir` que todavía no corrieron.
 * Cada archivo corre en su propia transacción: o entra entero o no entra.
 * Se conecta con el rol dueño (beecrm_owner); la app NUNCA migra.
 */
export async function runMigrations(ownerUrl: string, dir: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const pending = (await readdir(dir)).filter((f) => f.endsWith('.sql') && !applied.has(f)).sort();

    for (const file of pending) {
      const sql = await readFile(join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Falló la migración ${file}: ${(error as Error).message}`);
      }
    }
    return pending;
  } finally {
    await client.end();
  }
}
