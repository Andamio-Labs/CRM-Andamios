import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../scripts/migrator.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    databaseOwnerUrl: string;
  }
}

let container: StartedPostgreSqlContainer;

/** Un Postgres real y efímero por corrida: mismas extensiones, roles y migraciones que docker-compose. */
export async function setup(project: TestProject) {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
    .withDatabase('beecrm')
    .withUsername('beecrm_owner')
    .withPassword('beecrm_owner')
    .withCopyFilesToContainer([
      {
        source: fileURLToPath(new URL('../../../docker/postgres/init/01-roles-and-extensions.sql', import.meta.url)),
        target: '/docker-entrypoint-initdb.d/01-roles-and-extensions.sql',
      },
    ])
    .start();

  const host = `${container.getHost()}:${container.getPort()}`;
  const databaseOwnerUrl = `postgres://beecrm_owner:beecrm_owner@${host}/beecrm`;
  await runMigrations(databaseOwnerUrl, fileURLToPath(new URL('../migrations', import.meta.url)));

  project.provide('databaseOwnerUrl', databaseOwnerUrl);
  project.provide('databaseUrl', `postgres://beecrm_app:beecrm_app@${host}/beecrm`);
}

export async function teardown() {
  await container?.stop();
}
