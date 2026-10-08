import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { PG_POOL } from '../src/shared/tokens.js';
import { createTeam, createTestApp, type TestApp } from './support/test-app.js';

/** E13-S04 — Eliminar la empresa y todos sus datos, con doble confirmación. */
describe('Eliminación de la empresa (E13-S04)', () => {
  let t: TestApp;
  const storageDir = join(process.env.TMPDIR ?? '/tmp', `beecrm-deletion-${Date.now()}`);

  beforeAll(async () => {
    t = await createTestApp({ STORAGE_DIR: storageDir });
  });
  afterAll(() => t.close());

  const tenantOf = async (email: string) =>
    (await t.owner.query<{ id: string; name: string }>(`SELECT o.id, o.name FROM organization o JOIN member m ON m."organizationId" = o.id JOIN "user" u ON u.id = m."userId" WHERE u.email = $1`, [email])).rows[0]!;
  const codeFor = (email: string) => t.mailer.sent.findLast((m) => m.to === email && /eliminar/i.test(m.subject))!.text.match(/\b(\d{6})\b/)![1]!;

  it('solo el propietario la pide; llega un código por correo', async () => {
    const team = await createTeam(t, 'Pide Borrar SAS');
    await team.admin.api.post('/api/v1/tenant/deletion-request').expect(403);
    await team.owner.api.post('/api/v1/tenant/deletion-request').expect(202);
    expect(codeFor(team.owner.email)).toMatch(/^\d{6}$/);
  });

  it('exige el código y el nombre exacto de la empresa; el código se bloquea tras 5 intentos', async () => {
    const team = await createTeam(t, 'Confirma SAS');
    const del = (body: object) => team.owner.agent.delete('/api/v1/tenant').set('Origin', 'http://localhost:5173').send(body);
    expect((await del({ code: '123456', companyName: 'Confirma SAS' }).expect(404)).body.code).toBe('DELETION_NOT_REQUESTED');
    await team.owner.api.post('/api/v1/tenant/deletion-request').expect(202);
    const code = codeFor(team.owner.email);
    expect((await del({ code, companyName: 'confirma sas' }).expect(400)).body.code).toBe('COMPANY_NAME_MISMATCH');
    for (let i = 0; i < 4; i++) await del({ code: '000000', companyName: 'Confirma SAS' }).expect(400);
    expect((await del({ code, companyName: 'Confirma SAS' }).expect(400)).body.code).toBe('DELETION_CODE_LOCKED');
    expect(await tenantOf(team.owner.email)).toBeTruthy();
  });

  it('el código vence a los 30 minutos', async () => {
    const team = await createTeam(t, 'Vence Código SAS');
    await team.owner.api.post('/api/v1/tenant/deletion-request').expect(202);
    const { id } = await tenantOf(team.owner.email);
    await t.owner.query(`UPDATE tenant_deletion_codes SET expires_at = now() - interval '1 second' WHERE tenant_id = $1`, [id]);
    expect((await team.owner.agent.delete('/api/v1/tenant').set('Origin', 'http://localhost:5173')
      .send({ code: codeFor(team.owner.email), companyName: 'Vence Código SAS' }).expect(400)).body.code).toBe('DELETION_CODE_INVALID');
  });

  it('borra todo: datos, archivos, usuarios y sesiones; deja constancia sin datos personales; la otra empresa queda intacta', async () => {
    const team = await createTeam(t, 'Se Va SAS');
    const other = await createTeam(t, 'Se Queda SAS');
    const keepId = (await other.owner.api.post('/api/v1/contacts', { name: 'Cliente que sigue' }).expect(201)).body.id;
    await team.owner.api.post('/api/v1/contacts', { name: 'Cliente que se va' }).expect(201);
    const { id } = await tenantOf(team.owner.email);
    mkdirSync(join(storageDir, 't', id, 'm'), { recursive: true });
    writeFileSync(join(storageDir, 't', id, 'm', 'archivo'), 'x');

    // En solo lectura también se puede eliminar.
    await t.owner.query(`UPDATE subscriptions SET status = 'read_only' WHERE tenant_id = $1`, [id]);
    await team.owner.api.post('/api/v1/tenant/deletion-request').expect(202);
    await team.owner.agent.delete('/api/v1/tenant').set('Origin', 'http://localhost:5173').send({ code: codeFor(team.owner.email), companyName: 'Se Va SAS' }).expect(200);

    for (const table of ['contacts', 'deals', 'pipelines', 'subscriptions', 'audit_log', 'tenant_settings']) {
      expect((await t.owner.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [id])).rows[0].n, table).toBe(0);
    }
    expect((await t.owner.query(`SELECT count(*)::int AS n FROM organization WHERE id = $1`, [id])).rows[0].n).toBe(0);
    expect((await t.owner.query(`SELECT count(*)::int AS n FROM "user" WHERE email = ANY($1)`, [[team.owner.email, team.admin.email, team.seller.email]])).rows[0].n).toBe(0);
    expect(existsSync(join(storageDir, 't', id))).toBe(false);
    const { rows } = await t.owner.query(`SELECT * FROM tenant_deletions WHERE organization_id = $1`, [id]);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toMatch(/Se Va|@/);

    await team.owner.api.get('/api/v1/contacts').expect(401);
    expect((await other.owner.api.get(`/api/v1/contacts/${keepId}`).expect(200)).body.name).toBe('Cliente que sigue');
  });

  it('purge_tenant solo borra el tenant activo de la transacción', async () => {
    const victim = await createTeam(t, 'Víctima SAS');
    const { id } = await tenantOf(victim.owner.email);
    const client = await t.app.get<{ pool: pg.Pool }>(PG_POOL).pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', 'otro-tenant', true)`);
      await expect(client.query('SELECT purge_tenant($1)', [id])).rejects.toThrow(/tenant/);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(await tenantOf(victim.owner.email)).toBeTruthy();
  });
});
