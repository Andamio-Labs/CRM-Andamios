import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Env } from '../../../config/env.js';
import type { LlmProvider, LlmResponse } from '../../../shared/ai/llm.js';
import { aiInteractions, contacts, conversations, deals, messages, stages, tasks, user } from '../../../shared/database/schema.js';
import { AppError } from '../../../shared/http/app-error.js';
import { RealtimeGateway } from '../../../shared/realtime/realtime.gateway.js';
import { ENV, LLM_PROVIDER } from '../../../shared/tokens.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { TenantContext } from '../../tenancy/application/tenant-context.js';
import { costMicros } from '../domain/cost.js';
import { buildInsightPrompt, type InsightInput, insightNote, parseInsight } from '../domain/insights.js';

/** Los últimos mensajes bastan para resumir y mantienen acotado el costo por clic. */
const TRANSCRIPT_LIMIT = 30;

/**
 * E05-S10 — Un clic en el negocio: resumen del cliente, temperatura, próximo paso y respuesta sugerida.
 * Queda como nota interna en su conversación (si tiene) y en el registro de IA con su costo; no cuenta
 * para la cuota de respuestas del agente.
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly tenant: TenantContext,
    private readonly realtime: RealtimeGateway,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async forDeal(auth: AuthContext, dealId: string) {
    if (!this.llm.configured) {
      throw new AppError(HttpStatus.CONFLICT, 'AI_NOT_CONFIGURED', 'Conecta un proveedor de IA (Groq o DeepSeek) para usar el resumen del cliente.');
    }
    const { input, conversationId, contactOwnerId } = await this.tenant.run(auth, async (tx) => {
      if (!z.uuid().safeParse(dealId).success) throw new NotFoundException();
      const [deal] = await tx.select({ deal: deals, stage: stages.name, owner: user.name }).from(deals)
        .innerJoin(stages, eq(stages.id, deals.stageId)).leftJoin(user, eq(user.id, deals.ownerId))
        .where(and(eq(deals.id, dealId), await this.tenant.visibilityFilter(tx, auth, deals.ownerId)));
      if (!deal) throw new NotFoundException();
      const [contact] = deal.deal.contactId
        ? await tx.select({ name: contacts.name, ownerId: contacts.ownerId }).from(contacts).where(eq(contacts.id, deal.deal.contactId))
        : [];
      const [conversation] = deal.deal.contactId
        ? await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.contactId, deal.deal.contactId)).orderBy(desc(conversations.lastMessageAt)).limit(1)
        : [];
      const recent = conversation
        ? await tx.select({ direction: messages.direction, body: messages.body, type: messages.type }).from(messages)
          .where(eq(messages.conversationId, conversation.id)).orderBy(desc(messages.createdAt)).limit(TRANSCRIPT_LIMIT)
        : [];
      const openTasks = await tx.select({ title: tasks.title }).from(tasks)
        .where(and(eq(tasks.dealId, dealId), eq(tasks.status, 'open'))).orderBy(asc(tasks.dueAt)).limit(10);
      const [company] = (await tx.execute(sql`SELECT name FROM organization WHERE id = ${auth.tenantId}`)).rows as { name: string }[];
      const input: InsightInput = {
        company: company?.name ?? 'la empresa',
        deal: { title: deal.deal.title, stage: deal.stage, value: `${Number(deal.deal.value)} ${deal.deal.currency}`, owner: deal.owner, description: deal.deal.description },
        contact: contact?.name ?? null,
        tasks: openTasks.map((t) => t.title),
        messages: recent.reverse().map((m) => ({
          from: m.direction === 'in' ? 'cliente' : m.direction === 'out' ? 'equipo' : 'nota interna',
          text: m.body ?? `(${m.type})`,
        })),
      };
      return { input, conversationId: conversation?.id ?? null, contactOwnerId: contact?.ownerId ?? null };
    });

    const prompt = buildInsightPrompt(input);
    const started = Date.now();
    let response: LlmResponse | null = null;
    let failure: string | null = null;
    try {
      response = await this.llm.complete(prompt);
    } catch (error) {
      failure = (error as Error).message;
    }
    const insight = response ? parseInsight(response.text) : null;

    const noteId = await this.tenant.run(auth, async (tx) => {
      await tx.insert(aiInteractions).values({
        tenantId: auth.tenantId, conversationId, channel: 'insight', outcome: insight ? 'replied' : 'error', model: response?.model ?? null,
        prompt: { system: prompt.system, messages: prompt.messages }, response: response?.text ?? null,
        inputTokens: response?.inputTokens ?? 0, outputTokens: response?.outputTokens ?? 0, latencyMs: Date.now() - started,
        costMicros: response ? costMicros(response.inputTokens, response.outputTokens, { inputPerMTok: this.env.LLM_PRICE_INPUT_PER_MTOK, outputPerMTok: this.env.LLM_PRICE_OUTPUT_PER_MTOK }) : 0,
        error: insight ? null : (failure ?? 'Respuesta del modelo sin el formato esperado'),
      });
      if (!insight || !conversationId) return null;
      const [note] = await tx.insert(messages).values({
        tenantId: auth.tenantId, conversationId, direction: 'note', type: 'note', body: insightNote(insight), status: 'internal', sentBy: auth.userId,
      }).returning({ id: messages.id });
      return note!.id;
    });
    if (!insight) throw new AppError(HttpStatus.BAD_GATEWAY, 'AI_FAILED', 'La IA no pudo generar el resumen. Inténtalo de nuevo en un momento.');
    if (noteId) this.realtime.publish(auth.tenantId, 'message.created', { conversationId, messageId: noteId }, contactOwnerId);
    return { ...insight, savedAsNote: Boolean(noteId) };
  }
}
