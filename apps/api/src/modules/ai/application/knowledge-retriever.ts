import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { EmbeddingProvider } from '../../../shared/ai/embeddings.js';
import type { Database } from '../../../shared/database/database.js';
import { withTenant } from '../../../shared/database/with-tenant.js';
import { DB, EMBEDDINGS_PROVIDER } from '../../../shared/tokens.js';
import { toVector } from '../infrastructure/providers.js';

export interface Retrieved {
  sourceId: string;
  title: string;
  content: string;
  distance: number;
}

/** Fragmentos más lejanos que esto (distancia coseno) no tienen relación con la pregunta. */
const MAX_DISTANCE = 0.8;

/**
 * E05-S03 — Búsqueda en la base de conocimiento. Exacta (sin HNSW) y aislada por RLS: ver la
 * migración 0012. El vector de la pregunta se pide fuera de la transacción.
 */
@Injectable()
export class KnowledgeRetriever {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(EMBEDDINGS_PROVIDER) private readonly embeddings: EmbeddingProvider,
  ) {}

  get configured() {
    return this.embeddings.configured;
  }

  async search(tenantId: string, query: string, limit = 4): Promise<Retrieved[]> {
    if (!this.embeddings.configured || !query.trim()) return [];
    const [vector] = await this.embeddings.embed([query]);
    const rows = await withTenant(this.db, tenantId, async (tx) => (await tx.execute<{ source_id: string; title: string; content: string; distance: number }>(sql`
      SELECT c.source_id, s.title, c.content, (c.embedding <=> ${toVector(vector!)}::vector)::float8 AS distance
      FROM knowledge_chunks c JOIN knowledge_sources s ON s.id = c.source_id
      WHERE c.embedding IS NOT NULL AND s.status = 'ready'
      ORDER BY distance LIMIT ${limit}`)).rows);
    return rows.filter((r) => r.distance <= MAX_DISTANCE)
      .map((r) => ({ sourceId: r.source_id, title: r.title, content: r.content, distance: r.distance }));
  }
}
