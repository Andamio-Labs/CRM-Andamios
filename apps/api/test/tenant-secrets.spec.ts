import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TenantSecrets } from '../src/modules/tenancy/infrastructure/tenant-secrets.js';
import { SecretBox } from '../src/shared/crypto/secret-box.js';
import { createDatabase, type Database } from '../src/shared/database/database.js';

/** E13-S05 — Los tokens viven cifrados en la base y aislados por tenant. */
describe('TenantSecrets (E13-S05)', () => {
  let owner: pg.Client;
  let pool: pg.Pool;
  let db: Database;
  let secrets: TenantSecrets;
  const tenantA = `org_${randomUUID()}`;
  const tenantB = `org_${randomUUID()}`;

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: inject('databaseOwnerUrl') });
    await owner.connect();
    for (const id of [tenantA, tenantB]) {
      await owner.query(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $1, $1, now())`, [id]);
    }
    ({ db, pool } = createDatabase(inject('databaseUrl')));
    secrets = new TenantSecrets(db, new SecretBox({ activeKeyId: 'k1', keys: { k1: randomBytes(32) } }));
  });

  afterAll(async () => {
    await owner.query(`DELETE FROM organization WHERE id = ANY($1)`, [[tenantA, tenantB]]);
    await owner.end();
    await pool.end();
  });

  it('guarda y lee un secreto', async () => {
    await secrets.put(tenantA, 'whatsapp.access_token', 'EAAG-token-A');
    expect(await secrets.get(tenantA, 'whatsapp.access_token')).toBe('EAAG-token-A');
  });

  it('en la base solo hay texto cifrado', async () => {
    await secrets.put(tenantA, 'whatsapp.app_secret', 'super-secreto');
    const { rows } = await owner.query(`SELECT * FROM tenant_secrets WHERE tenant_id = $1`, [tenantA]);
    expect(JSON.stringify(rows)).not.toContain('super-secreto');
    expect(JSON.stringify(rows)).not.toContain('EAAG-token-A');
  });

  it('otro tenant no lo ve (RLS)', async () => {
    await secrets.put(tenantA, 'meta.token', 'solo-de-A');
    expect(await secrets.get(tenantB, 'meta.token')).toBeNull();
  });

  it('si alguien copia el cifrado a otro tenant, no se descifra (AAD)', async () => {
    await secrets.put(tenantA, 'copiado', 'solo-de-A');
    await owner.query(
      `INSERT INTO tenant_secrets (tenant_id, name, ciphertext)
       SELECT $2, name, ciphertext FROM tenant_secrets WHERE tenant_id = $1 AND name = 'copiado'`,
      [tenantA, tenantB],
    );
    await expect(secrets.get(tenantB, 'copiado')).rejects.toThrow();
  });

  it('sobrescribe el valor existente', async () => {
    await secrets.put(tenantA, 'rotable', 'v1');
    await secrets.put(tenantA, 'rotable', 'v2');
    expect(await secrets.get(tenantA, 'rotable')).toBe('v2');
  });
});
