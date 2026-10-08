import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { aiInteractions, contacts, conversations } from '../../../shared/database/schema.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { TenantContext } from '../../tenancy/application/tenant-context.js';

export const listInteractionsSchema = z.object({
  outcome: z.enum(['replied', 'handoff', 'blocked', 'error', 'quota']).optional(),
  channel: z.enum(['whatsapp', 'preview']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const encode = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
const decode = (cursor: string) => {
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const date = new Date(at ?? '');
  return Number.isNaN(date.getTime()) || !z.uuid().safeParse(id).success ? null : { at: date, id: id! };
};

/** E05-S08 — Registro de turnos del agente: prompt, respuesta, modelo, tokens, costo y resultado. */
@Injectable()
export class AiLogsService {
  constructor(private readonly tenant: TenantContext) {}

  list(auth: AuthContext, { outcome, channel, cursor, limit }: z.infer<typeof listInteractionsSchema>) {
    return this.tenant.run(auth, async (tx) => {
      const after = cursor ? decode(cursor) : null;
      const rows = await tx.select({
        id: aiInteractions.id, createdAt: aiInteractions.createdAt, channel: aiInteractions.channel, outcome: aiInteractions.outcome,
        model: aiInteractions.model, inputTokens: aiInteractions.inputTokens, outputTokens: aiInteractions.outputTokens,
        costMicros: aiInteractions.costMicros, latencyMs: aiInteractions.latencyMs, violations: aiInteractions.violations,
        conversationId: aiInteractions.conversationId, contactName: contacts.name, error: aiInteractions.error,
        reply: sql<string | null>`left(${aiInteractions.response}, 300)`,
      }).from(aiInteractions)
        .leftJoin(conversations, eq(conversations.id, aiInteractions.conversationId))
        .leftJoin(contacts, eq(contacts.id, conversations.contactId))
        .where(and(
          outcome ? eq(aiInteractions.outcome, outcome) : undefined,
          channel ? eq(aiInteractions.channel, channel) : undefined,
          after ? or(lt(aiInteractions.createdAt, after.at), and(eq(aiInteractions.createdAt, after.at), lt(aiInteractions.id, after.id))) : undefined,
        ))
        .orderBy(desc(aiInteractions.createdAt), desc(aiInteractions.id)).limit(limit + 1);
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      const [totals] = await tx.select({
        interactions: sql<number>`count(*)::int`,
        costMicros: sql<number>`coalesce(sum(${aiInteractions.costMicros}), 0)::bigint`,
        inputTokens: sql<number>`coalesce(sum(${aiInteractions.inputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${aiInteractions.outputTokens}), 0)::bigint`,
      }).from(aiInteractions).where(sql`${aiInteractions.createdAt} >= date_trunc('month', now())`);
      return {
        items,
        nextCursor: rows.length > limit && last ? encode(last.createdAt, last.id) : null,
        month: { interactions: totals!.interactions, costMicros: Number(totals!.costMicros), inputTokens: Number(totals!.inputTokens), outputTokens: Number(totals!.outputTokens) },
      };
    });
  }

  get(auth: AuthContext, id: string) {
    return this.tenant.run(auth, async (tx) => {
      if (!z.uuid().safeParse(id).success) throw new NotFoundException();
      const [row] = await tx.select().from(aiInteractions).where(eq(aiInteractions.id, id));
      if (!row) throw new NotFoundException();
      const { tenantId: _t, ...interaction } = row;
      return interaction;
    });
  }
}
