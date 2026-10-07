import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

/**
 * E01-S05 — Guardián de esquema. No prueba UNA tabla: prueba TODAS.
 * Cualquier tabla nueva con tenant_id sin RLS forzado rompe el pipeline.
 */
describe('Invariantes de RLS (E01-S05)', () => {
  let owner: pg.Client;

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: inject('databaseOwnerUrl') });
    await owner.connect();
  });
  afterAll(() => owner.end());

  it('toda tabla con tenant_id tiene RLS habilitado, forzado y al menos una política', async () => {
    const { rows } = await owner.query<{
      table: string;
      rls: boolean;
      forced: boolean;
      policies: number;
    }>(`
      SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             (SELECT count(*)::int FROM pg_policies p WHERE p.tablename = c.relname) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
      WHERE c.relkind = 'r'`);

    expect(rows.length).toBeGreaterThan(0);
    const unprotected = rows.filter((r) => !r.rls || !r.forced || r.policies === 0).map((r) => r.table);
    expect(unprotected, `Tablas sin aislamiento: ${unprotected.join(', ')}`).toEqual([]);
  });

  it('el rol de la aplicación no es superusuario ni puede saltarse RLS', async () => {
    const { rows } = await owner.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'beecrm_app'`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});
