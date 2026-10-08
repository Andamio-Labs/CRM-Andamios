import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { LlmProvider } from '../../../shared/ai/llm.js';
import type { Transaction } from '../../../shared/database/database.js';
import { knowledgeChunks, knowledgeSources } from '../../../shared/database/schema.js';
import { LLM_PROVIDER } from '../../../shared/tokens.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { TenantContext } from '../../tenancy/application/tenant-context.js';
import { chunkFaq, chunkText } from '../domain/chunking.js';

const title = z.string().trim().min(1).max(200);
const content = z.string().trim().min(1).max(100_000);
const items = z.array(z.object({ question: z.string().trim().min(1).max(500), answer: z.string().trim().min(1).max(4000) }).strict()).min(1).max(500);

export const createSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), title, content }).strict(),
  z.object({ kind: z.literal('faq'), title, items }).strict(),
]);
export const updateSourceSchema = z.object({ title, content, items }).partial().strict();

type SourceRow = typeof knowledgeSources.$inferSelect;
const summary = ({ tenantId: _t, content: _c, faq: _f, ...row }: SourceRow) => row;
const detail = (row: SourceRow) => ({ ...summary(row), content: row.content, items: row.faq });

/**
 * E05-S02 — Base de conocimiento. Cada fuente se trocea al guardarse; los fragmentos quedan
 * "esperando IA" hasta que se conecte el modelo de embeddings y se indexen en pgvector.
 */
@Injectable()
export class KnowledgeService {
  constructor(
    private readonly tenant: TenantContext,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  list(auth: AuthContext) {
    return this.tenant.run(auth, async (tx) => (await tx.select().from(knowledgeSources).orderBy(desc(knowledgeSources.createdAt))).map(summary));
  }

  get(auth: AuthContext, id: string) {
    return this.tenant.run(auth, async (tx) => detail(await this.find(tx, id)));
  }

  create(auth: AuthContext, input: z.infer<typeof createSourceSchema>) {
    return this.tenant.run(auth, async (tx) => {
      const [row] = await tx.insert(knowledgeSources).values({
        tenantId: auth.tenantId, kind: input.kind, title: input.title, createdBy: auth.userId, status: this.pendingStatus(),
        content: input.kind === 'text' ? input.content : null, faq: input.kind === 'faq' ? input.items : null,
      }).returning();
      return summary(await this.rechunk(tx, row!));
    });
  }

  update(auth: AuthContext, id: string, input: z.infer<typeof updateSourceSchema>) {
    return this.tenant.run(auth, async (tx) => {
      const source = await this.find(tx, id);
      const [row] = await tx.update(knowledgeSources).set({
        title: input.title ?? source.title,
        content: source.kind === 'text' ? (input.content ?? source.content) : null,
        faq: source.kind === 'faq' ? (input.items ?? source.faq) : null,
        updatedAt: new Date(),
      }).where(eq(knowledgeSources.id, id)).returning();
      return summary(await this.rechunk(tx, row!));
    });
  }

  remove(auth: AuthContext, id: string) {
    return this.tenant.run(auth, async (tx) => {
      await this.find(tx, id);
      await tx.delete(knowledgeSources).where(eq(knowledgeSources.id, id));
    });
  }

  private async rechunk(tx: Transaction, source: SourceRow) {
    const chunks = source.kind === 'faq' ? chunkFaq(source.faq ?? []) : chunkText(source.content ?? '');
    await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.sourceId, source.id));
    if (chunks.length) {
      await tx.insert(knowledgeChunks).values(chunks.map((content, ordinal) => ({ tenantId: source.tenantId, sourceId: source.id, ordinal, content })));
    }
    const [row] = await tx.update(knowledgeSources).set({ chunkCount: chunks.length, status: this.pendingStatus(), error: null })
      .where(eq(knowledgeSources.id, source.id)).returning();
    return row!;
  }

  /** Sin IA conectada, todo queda esperándola; con IA, la cola de indexación lo toma (E05-S03). */
  private pendingStatus() {
    return this.llm.configured ? 'indexing' as const : 'waiting_ai' as const;
  }

  private async find(tx: Transaction, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    const [row] = await tx.select().from(knowledgeSources).where(eq(knowledgeSources.id, id));
    if (!row) throw new NotFoundException();
    return row;
  }
}
