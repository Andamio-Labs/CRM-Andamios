import { Global, Module } from '@nestjs/common';
import type { Env } from '../../config/env.js';
import { ENV, STORAGE } from '../tokens.js';
import { LocalDiskStorage } from './object-storage.js';

/** E04-S06 — Archivos en disco local (STORAGE_DIR). Para la nube, otro adaptador del mismo puerto. */
@Global()
@Module({
  providers: [{ provide: STORAGE, inject: [ENV], useFactory: (env: Env) => new LocalDiskStorage(env.STORAGE_DIR, env.STORAGE_SIGNING_KEY, env.APP_URL) }],
  exports: [STORAGE],
})
export class StorageModule {}
