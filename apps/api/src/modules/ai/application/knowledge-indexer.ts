import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import type { EmbeddingProvider } from '../../../shared/ai/embeddings.js';
import type { Database } from '../../../shared/database/database.js';
import { knowledgeChunks, knowledgeSources } from '../../../shared/database/schema.js';
import { withTenant } from '../../../shared/database/with-tenant.js';
import type { JobQueue } from '../../../shared/queue/bull-queue.js';
import { DB, EMBEDDINGS_PROVIDER, JOB_QUEUE, PG_POOL } from '../../../shared/tokens.js';
import { toVector } from '../infrastructure/providers.js';

export interface IndexJob {
  tenantId: string;
  sourceId: string;
}

/**
 * E05-S02 — Indexación en pgvector. Lee los fragmentos, pide los vectores FUERA de la transacción
 * (el modelo puede tardar) y los guarda. Si la fuente cambió mientras tanto, el resultado se descarta:
 * la edición encoló su propia indexación.
 */
@Injectable()
export class KnowledgeIndexer {
  private readonly logger = new Logger('KnowledgeIndexer');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PG_POOL) private readonly conn: { pool: pg.Pool },
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(EMBEDDINGS_PROVIDER) private readonly embeddings: EmbeddingProvider,
  ) {}

  get configured() {
    return this.embeddings.configured;
  }

  /** Encola la indexación (después del commit de quien cargó la fuente). */
  async schedule(tenantId: string, source: { id: string; updatedAt: Date }) {
    if (!this.embeddings.configured) return;
    await this.queue.enqueue('ai', 'ai.index', { tenantId, sourceId: source.id } satisfies IndexJob, { jobId: `index:${source.id}:${source.updatedAt.getTime()}` });
  }

  async index({ tenantId, sourceId }: IndexJob) {
    if (!this.embeddings.configured) return;
    const loaded = await withTenant(this.db, tenantId, async (tx) => {
      const [source] = await tx.update(knowledgeSources).set({ status: 'indexing', error: null }).where(eq(knowledgeSources.id, sourceId)).returning();
      if (!source) return null;
      const chunks = await tx.select({ id: knowledgeChunks.id, content: knowledgeChunks.content }).from(knowledgeChunks)
        .where(eq(knowledgeChunks.sourceId, sourceId)).orderBy(asc(knowledgeChunks.ordinal));
      return { source, chunks };
    });
    if (!loaded) return;

    let vectors: number[][];
    try {
      vectors = await this.embeddings.embed(loaded.chunks.map((c) => c.content));
    } catch (error) {
      this.logger.error(`Indexar ${sourceId}: ${(error as Error).message}`);
      await withTenant(this.db, tenantId, (tx) => tx.update(knowledgeSources)
        .set({ status: 'failed', error: 'No se pudo indexar: el modelo de embeddings no respondió. Se reintenta solo.' })
        .where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.updatedAt, loaded.source.updatedAt))));
      return;
    }

    await withTenant(this.db, tenantId, async (tx) => {
      const [current] = await tx.select({ updatedAt: knowledgeSources.updatedAt }).from(knowledgeSources).where(eq(knowledgeSources.id, sourceId)).for('update');
      if (!current || current.updatedAt.getTime() !== loaded.source.updatedAt.getTime()) return; // cambió: otra indexación en camino
      for (const [i, chunk] of loaded.chunks.entries()) {
        await tx.update(knowledgeChunks).set({ embedding: sql`${toVector(vectors[i]!)}::vector` as never }).where(eq(knowledgeChunks.id, chunk.id));
      }
      await tx.update(knowledgeSources).set({ status: 'ready', error: null }).where(eq(knowledgeSources.id, sourceId));
    });
  }

  /** Barrido: lo que se cargó sin modelo, lo que falló y lo que quedó trabado. */
  async sweep(now = new Date()) {
    if (!this.embeddings.configured) return;
    const { rows } = await this.conn.pool.query<{ tenant_id: string; source_id: string }>('SELECT tenant_id, source_id FROM knowledge_pending_sources($1)', [now]);
    for (const row of rows) {
      await this.index({ tenantId: row.tenant_id, sourceId: row.source_id }).catch((error: Error) => this.logger.error(`Barrido ${row.source_id}: ${error.message}`));
    }
  }
}
