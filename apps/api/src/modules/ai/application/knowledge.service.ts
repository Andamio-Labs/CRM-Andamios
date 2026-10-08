import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { extractText, getDocumentProxy } from 'unpdf';
import { z } from 'zod';
import type { Transaction } from '../../../shared/database/database.js';
import { knowledgeChunks, knowledgeSources } from '../../../shared/database/schema.js';
import { AppError } from '../../../shared/http/app-error.js';
import { PAGE_FETCHER } from '../../../shared/tokens.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { TenantContext } from '../../tenancy/application/tenant-context.js';
import { chunkFaq, chunkText } from '../domain/chunking.js';
import { htmlToText } from '../domain/web-page.js';
import { type PageFetcher, UnsafeUrlError } from '../infrastructure/page-fetcher.js';
import { KnowledgeIndexer } from './knowledge-indexer.js';

const MAX_CONTENT = 100_000;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

const title = z.string().trim().min(1).max(200);
const content = z.string().trim().min(1).max(MAX_CONTENT);
const items = z.array(z.object({ question: z.string().trim().min(1).max(500), answer: z.string().trim().min(1).max(4000) }).strict()).min(1).max(500);
const url = z.url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'Solo direcciones http o https');

export const createSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), title, content }).strict(),
  z.object({ kind: z.literal('faq'), title, items }).strict(),
  z.object({ kind: z.literal('url'), title, url }).strict(),
]);
export const updateSourceSchema = z.object({ title, content, items }).partial().strict();
export const pdfFieldsSchema = z.object({ title }).strict();

type SourceRow = typeof knowledgeSources.$inferSelect;
type NewSource = Pick<typeof knowledgeSources.$inferInsert, 'kind' | 'title' | 'content' | 'faq' | 'url' | 'fileName'>;
const summary = ({ tenantId: _t, content: _c, faq: _f, ...row }: SourceRow) => row;
const detail = (row: SourceRow) => ({ ...summary(row), content: row.content, items: row.faq });

/**
 * E05-S02 — Base de conocimiento: FAQ, texto, PDF y URL. Cada fuente se trocea al guardarse y se
 * indexa en pgvector después del commit; sin modelo de embeddings queda "esperando IA".
 */
@Injectable()
export class KnowledgeService {
  constructor(
    private readonly tenant: TenantContext,
    private readonly indexer: KnowledgeIndexer,
    @Inject(PAGE_FETCHER) private readonly fetchPage: PageFetcher,
  ) {}

  list(auth: AuthContext) {
    return this.tenant.run(auth, async (tx) => (await tx.select().from(knowledgeSources).orderBy(desc(knowledgeSources.createdAt))).map(summary));
  }

  get(auth: AuthContext, id: string) {
    return this.tenant.run(auth, async (tx) => detail(await this.find(tx, id)));
  }

  async create(auth: AuthContext, input: z.infer<typeof createSourceSchema>) {
    if (input.kind === 'url') {
      return this.save(auth, { kind: 'url', title: input.title, url: input.url, content: await this.readPage(input.url) });
    }
    return this.save(auth, input.kind === 'text'
      ? { kind: 'text', title: input.title, content: input.content }
      : { kind: 'faq', title: input.title, faq: input.items });
  }

  /** PDF con texto: se extrae y se guarda el texto (el archivo no se conserva). */
  async createFromPdf(auth: AuthContext, fields: z.infer<typeof pdfFieldsSchema>, file?: { originalname: string; buffer: Buffer }) {
    if (!file || file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new AppError(HttpStatus.BAD_REQUEST, 'INVALID_PDF', 'El archivo no es un PDF');
    }
    let text: string;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(file.buffer));
      text = ((await extractText(pdf, { mergePages: false })).text as string[]).map((page) => page.trim()).filter(Boolean).join('\n\n');
    } catch {
      throw new AppError(HttpStatus.BAD_REQUEST, 'INVALID_PDF', 'No se pudo leer el PDF: puede estar dañado o protegido con contraseña');
    }
    if (!text.trim()) {
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'PDF_WITHOUT_TEXT', 'El PDF no tiene texto seleccionable (¿es una imagen escaneada?). Carga el contenido como texto.');
    }
    return this.save(auth, { kind: 'pdf', title: fields.title, fileName: file.originalname.slice(0, 200), content: text.slice(0, MAX_CONTENT) });
  }

  async update(auth: AuthContext, id: string, input: z.infer<typeof updateSourceSchema>) {
    const row = await this.tenant.run(auth, async (tx) => {
      const source = await this.find(tx, id);
      const [row] = await tx.update(knowledgeSources).set({
        title: input.title ?? source.title,
        content: source.kind === 'faq' ? null : (source.kind === 'text' ? (input.content ?? source.content) : source.content),
        faq: source.kind === 'faq' ? (input.items ?? source.faq) : null,
        updatedAt: new Date(),
      }).where(eq(knowledgeSources.id, id)).returning();
      return this.rechunk(tx, row!);
    });
    await this.indexer.schedule(auth.tenantId, row);
    return summary(row);
  }

  /** URL: vuelve a leer la página (el contenido del sitio cambió). */
  async refresh(auth: AuthContext, id: string) {
    const source = await this.tenant.run(auth, (tx) => this.find(tx, id));
    if (source.kind !== 'url' || !source.url) throw new AppError(HttpStatus.CONFLICT, 'NOT_A_URL', 'Solo las fuentes de tipo URL se vuelven a leer');
    const content = await this.readPage(source.url);
    const row = await this.tenant.run(auth, async (tx) => {
      const [row] = await tx.update(knowledgeSources).set({ content, updatedAt: new Date() }).where(eq(knowledgeSources.id, id)).returning();
      if (!row) throw new NotFoundException();
      return this.rechunk(tx, row);
    });
    await this.indexer.schedule(auth.tenantId, row);
    return summary(row);
  }

  remove(auth: AuthContext, id: string) {
    return this.tenant.run(auth, async (tx) => {
      await this.find(tx, id);
      await tx.delete(knowledgeSources).where(eq(knowledgeSources.id, id));
    });
  }

  private async save(auth: AuthContext, source: NewSource) {
    const row = await this.tenant.run(auth, async (tx) => {
      const [row] = await tx.insert(knowledgeSources).values({ ...source, tenantId: auth.tenantId, createdBy: auth.userId, status: this.pendingStatus() }).returning();
      return this.rechunk(tx, row!);
    });
    await this.indexer.schedule(auth.tenantId, row);
    return summary(row);
  }

  private async readPage(address: string) {
    let page;
    try {
      page = await this.fetchPage(address);
    } catch (error) {
      if (error instanceof UnsafeUrlError) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'UNSAFE_URL', error.message);
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'URL_UNREACHABLE', `No pudimos leer la página: ${(error as Error).message}`);
    }
    const text = page.contentType.includes('html') ? htmlToText(page.body).text : page.body.trim();
    if (!text) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'URL_WITHOUT_TEXT', 'La página no tiene texto para leer');
    return text.slice(0, MAX_CONTENT);
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

  /** Sin modelo de embeddings, todo queda esperándolo; con modelo, la cola de indexación lo toma. */
  private pendingStatus() {
    return this.indexer.configured ? 'indexing' as const : 'waiting_ai' as const;
  }

  private async find(tx: Transaction, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    const [row] = await tx.select().from(knowledgeSources).where(eq(knowledgeSources.id, id));
    if (!row) throw new NotFoundException();
    return row;
  }
}
