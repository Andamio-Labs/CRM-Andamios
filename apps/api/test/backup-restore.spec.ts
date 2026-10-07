import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../scripts/migrator.ts';

/**
 * E15-S04 — Backups cifrados con retención y restauración PROBADA.
 * Corre los mismos scripts que el servicio `backup` de docker-compose.
 */
describe('Backup y restauración (E15-S04)', () => {
  let pg: StartedPostgreSqlContainer;
  const env = {
    PGHOST: 'localhost',
    PGUSER: 'beecrm_owner',
    PGPASSWORD: 'beecrm_owner',
    PGDATABASE: 'beecrm',
    BACKUP_DIR: '/backups',
    BACKUP_PASSPHRASE: 'frase-de-prueba-larga',
    RETENTION_DAYS: '30',
  };
  const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

  async function sh(cmd: string, extraEnv: Record<string, string> = {}) {
    return pg.exec(['bash', '-c', cmd], { env: { ...env, ...extraEnv } });
  }
  async function psql(db: string, sql: string) {
    return (await sh(`psql -d ${db} -tAc "${sql}"`)).output.trim();
  }

  beforeAll(async () => {
    pg = await new PostgreSqlContainer('pgvector/pgvector:pg17')
      .withDatabase('beecrm')
      .withUsername('beecrm_owner')
      .withPassword('beecrm_owner')
      .withCopyFilesToContainer([
        { source: path('../../../docker/postgres/init/01-roles-and-extensions.sql'), target: '/docker-entrypoint-initdb.d/01.sql' },
        { source: path('../../../docker/backup/backup.sh'), target: '/scripts/backup.sh', mode: 0o755 },
        { source: path('../../../docker/backup/restore.sh'), target: '/scripts/restore.sh', mode: 0o755 },
      ])
      .start();
    await runMigrations(pg.getConnectionUri(), path('../migrations'));
    await psql(
      'beecrm',
      `INSERT INTO organization (id, name, slug, \\"createdAt\\") VALUES ('org-1', 'Clínica Sonrisas', 'clinica', now());
       INSERT INTO tenant_settings (tenant_id) VALUES ('org-1');`,
    );
  });

  afterAll(() => pg?.stop());

  it('genera un backup cifrado: el contenido no es legible', async () => {
    const run = await sh('/scripts/backup.sh');
    expect(run.exitCode, run.output).toBe(0);
    const files = await sh('ls /backups/*.dump.gpg | wc -l');
    expect(files.output.trim()).toBe('1');
    const leaked = await sh('grep -c "Clínica Sonrisas" /backups/*.dump.gpg || true');
    expect(leaked.output.trim()).toBe('0');
  });

  it('restaura en una base nueva con datos, roles y políticas RLS intactos', async () => {
    const file = (await sh('ls -t /backups/*.dump.gpg | head -1')).output.trim();
    const run = await sh(`/scripts/restore.sh ${file} beecrm_restore`);
    expect(run.exitCode, run.output).toBe(0);

    expect(await psql('beecrm_restore', 'SELECT name FROM organization')).toBe('Clínica Sonrisas');
    expect(await psql('beecrm_restore', 'SELECT timezone FROM tenant_settings')).toBe('America/Bogota');
    expect(await psql('beecrm_restore', "SELECT relforcerowsecurity FROM pg_class WHERE relname = 'tenant_settings'")).toBe('t');
    expect(await psql('beecrm_restore', 'SELECT count(*) FROM schema_migrations')).toBe(
      await psql('beecrm', 'SELECT count(*) FROM schema_migrations'),
    );
  });

  it('con la frase incorrecta no restaura nada', async () => {
    const file = (await sh('ls -t /backups/*.dump.gpg | head -1')).output.trim();
    const run = await sh(`/scripts/restore.sh ${file} beecrm_wrong_key`, { BACKUP_PASSPHRASE: 'otra-frase' });
    expect(run.exitCode).not.toBe(0);
    expect(run.output).toMatch(/decryption failed|Bad session key/i);
    expect(await psql('postgres', "SELECT count(*) FROM pg_database WHERE datname = 'beecrm_wrong_key'")).toBe('0');
  });

  it('detecta un backup alterado y no lo restaura', async () => {
    const file = (await sh('ls -t /backups/*.dump.gpg | head -1')).output.trim();
    await sh(`cp ${file} /tmp/tampered.gpg && printf '\\xff\\xff\\xff\\xff' | dd of=/tmp/tampered.gpg bs=1 seek=200 conv=notrunc 2>/dev/null`);
    const run = await sh('/scripts/restore.sh /tmp/tampered.gpg beecrm_tampered');
    expect(run.exitCode).not.toBe(0);
    expect(run.output).not.toMatch(/restore OK/);
    expect(await psql('postgres', "SELECT count(*) FROM pg_database WHERE datname = 'beecrm_tampered'")).toBe('0');
  });

  it('no pisa una base existente', async () => {
    const file = (await sh('ls -t /backups/*.dump.gpg | head -1')).output.trim();
    const run = await sh(`/scripts/restore.sh ${file} beecrm`);
    expect(run.exitCode).not.toBe(0);
  });

  it('borra los backups de más de 30 días y conserva los recientes', async () => {
    await sh(`touch -d '31 days ago' /backups/beecrm-20200101T000000Z.dump.gpg`);
    await sh(`touch -d '29 days ago' /backups/beecrm-20200201T000000Z.dump.gpg`);
    const run = await sh('/scripts/backup.sh');
    expect(run.output).toMatch(/1 backup\(s\) viejo\(s\) eliminado\(s\)/);
    const listing = (await sh('ls /backups')).output;
    expect(listing).not.toContain('20200101');
    expect(listing).toContain('20200201');
  });
});
