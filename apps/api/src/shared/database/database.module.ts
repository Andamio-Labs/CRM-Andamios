import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type pg from 'pg';
import type { Env } from '../../config/env.js';
import { DB, ENV, PG_POOL } from '../tokens.js';
import { createDatabase } from './database.js';

@Global()
@Module({
  providers: [
    { provide: PG_POOL, inject: [ENV], useFactory: (env: Env) => createDatabase(env.DATABASE_URL) },
    { provide: DB, inject: [PG_POOL], useFactory: (conn: ReturnType<typeof createDatabase>) => conn.db },
  ],
  exports: [PG_POOL, DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly conn: { pool: pg.Pool }) {}

  async onApplicationShutdown() {
    await this.conn.pool.end();
  }
}
