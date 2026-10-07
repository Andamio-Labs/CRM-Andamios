import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '../src/shared/database/database.js';
import { tenantSettings } from '../src/shared/database/schema.js';
import { withTenant } from '../src/shared/database/with-tenant.js';
import { DEFAULT_BUSINESS_HOURS } from '../src/modules/tenancy/domain/tenant-settings.js';

/** E01-S05 — Pruebas de fuga: corren con el rol REAL de la app (beecrm_app). */
describe('Aislamiento entre tenants (E01-S05)', () => {
  let owner: pg.Client;
  let pool: pg.Pool;
  let db: Database;
  const tenantA = `org_${randomUUID()}`;
  const tenantB = `org_${randomUUID()}`;

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: inject('databaseOwnerUrl') });
    await owner.connect();
    for (const id of [tenantA, tenantB]) {
      await owner.query(
        `INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, $1, $1, now())`,
        [id],
      );
      await owner.query(`INSERT INTO tenant_settings (tenant_id) VALUES ($1)`, [id]);
    }
    ({ db, pool } = createDatabase(inject('databaseUrl')));
  });

  afterAll(async () => {
    await owner.query(`DELETE FROM "organization" WHERE id = ANY($1)`, [[tenantA, tenantB]]);
    await owner.end();
    await pool.end();
  });

  it('sin tenant en contexto no devuelve NINGUNA fila', async () => {
    const rows = await db.select().from(tenantSettings);
    expect(rows).toEqual([]);
  });

  it('con tenant A solo ve filas de A', async () => {
    const rows = await withTenant(db, tenantA, (tx) => tx.select().from(tenantSettings));
    expect(rows.map((r) => r.tenantId)).toEqual([tenantA]);
  });

  it('desde A no puede modificar filas de B', async () => {
    const updated = await withTenant(db, tenantA, (tx) =>
      tx.execute(sql`UPDATE tenant_settings SET timezone = 'UTC' WHERE tenant_id = ${tenantB}`),
    );
    expect(updated.rowCount).toBe(0);
    const { rows } = await owner.query(`SELECT timezone FROM tenant_settings WHERE tenant_id = $1`, [tenantB]);
    expect(rows[0].timezone).toBe('America/Bogota');
  });

  it('desde A no puede insertar filas a nombre de B', async () => {
    await expect(
      withTenant(db, tenantA, (tx) =>
        tx.insert(tenantSettings).values({ tenantId: tenantB, businessHours: DEFAULT_BUSINESS_HOURS, outOfHoursMessage: 'x' }),
      ),
    ).rejects.toThrow();
  });

  it('el tenant no se filtra a la siguiente transacción de la misma conexión', async () => {
    await withTenant(db, tenantA, (tx) => tx.select().from(tenantSettings));
    const rows = await db.select().from(tenantSettings);
    expect(rows).toEqual([]);
  });

  it('rechaza un tenant vacío en vez de ejecutar sin aislamiento', async () => {
    await expect(withTenant(db, '', (tx) => tx.select().from(tenantSettings))).rejects.toThrow(
      /tenant/i,
    );
  });
});
