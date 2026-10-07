import { fileURLToPath } from 'node:url';
import { runMigrations } from './migrator.ts';

const ownerUrl =
  process.env.DATABASE_OWNER_URL ?? 'postgres://beecrm_owner:beecrm_owner@localhost:5442/beecrm';
const dir = fileURLToPath(new URL('../migrations', import.meta.url));

const applied = await runMigrations(ownerUrl, dir);
console.log(applied.length ? `Migraciones aplicadas: ${applied.join(', ')}` : 'Base al día, nada que migrar.');
