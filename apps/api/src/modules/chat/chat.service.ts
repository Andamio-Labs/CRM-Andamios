import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Transaction } from '../../shared/database/database.js';
import { deals, teamChatMembers, teamChats, teamMessages, user } from '../../shared/database/schema.js';
import { badRequest } from '../../shared/http/errors.js';
import { RealtimeGateway } from '../../shared/realtime/realtime.gateway.js';
import type { AuthContext } from '../identity/infrastructure/http/session.guard.js';
import { TenantContext } from '../tenancy/application/tenant-context.js';

export const createChatSchema = z
  .object({
    userIds: z.array(z.string().min(1).max(64)).min(1).max(30),
    title: z.string().trim().min(1).max(80).optional(),
    dealId: z.uuid().optional(),
  })
  .strict();
export const postMessageSchema = z.object({ body: z.string().trim().min(1).max(4000) }).strict();
export const listMessagesSchema = z.object({
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Como en la referencia: el autor puede borrar su mensaje durante la primera hora. */
export const DELETE_WINDOW_MS = 60 * 60_000;

type Chat = typeof teamChats.$inferSelect;
interface ChatRow {
  id: string;
  kind: Chat['kind'];
  title: string | null;
  dealId: string | null;
  dealTitle: string | null;
  createdBy: string | null;
  lastMessageAt: Date | string | null;
  unread: number;
  lastBody: string | null;
  lastAuthorId: string | null;
  lastDeleted: boolean | null;
}

/**
 * E12-S03 — Chat interno del equipo: general (toda la empresa), directo, grupo (con negocio adjunto si se
 * quiere) y notas personales. El tiempo real solo avisa "hay algo nuevo en el chat X" a sus miembros;
 * el contenido se pide con la sesión, que pasa por estos chequeos de acceso.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly tenant: TenantContext,
    private readonly realtime: RealtimeGateway,
  ) {}

  list(auth: AuthContext) {
    return this.tenant.run(auth, async (tx) => {
      await this.ensureBasics(tx, auth);
      const { rows } = await tx.execute(sql`
        SELECT c.id, c.kind, c.title, c.deal_id AS "dealId", d.title AS "dealTitle", c.created_by AS "createdBy",
               c.last_message_at AS "lastMessageAt",
               (SELECT count(*)::int FROM team_messages m
                 WHERE m.chat_id = c.id AND m.deleted_at IS NULL AND m.author_id IS DISTINCT FROM ${auth.userId}
                   AND m.created_at > coalesce(me.last_read_at, '-infinity'::timestamptz)) AS unread,
               lm.body AS "lastBody", lm.author_id AS "lastAuthorId", lm.deleted AS "lastDeleted"
        FROM team_chats c
        LEFT JOIN team_chat_members me ON me.chat_id = c.id AND me.user_id = ${auth.userId}
        LEFT JOIN deals d ON d.id = c.deal_id
        LEFT JOIN LATERAL (SELECT body, author_id, deleted_at IS NOT NULL AS deleted FROM team_messages
                           WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) lm ON true
        WHERE c.kind = 'general' OR (c.kind = 'notes' AND c.created_by = ${auth.userId})
           OR (c.kind IN ('direct', 'group') AND me.user_id IS NOT NULL)
        ORDER BY CASE c.kind WHEN 'general' THEN 0 WHEN 'notes' THEN 1 ELSE 2 END,
                 c.last_message_at DESC NULLS LAST, c.created_at DESC`);
      const chats = rows as unknown as ChatRow[];
      const ids = chats.filter((c) => c.kind === 'direct' || c.kind === 'group').map((c) => c.id);
      const members = ids.length
        ? await tx.select({ chatId: teamChatMembers.chatId, userId: teamChatMembers.userId, name: user.name })
          .from(teamChatMembers).innerJoin(user, eq(user.id, teamChatMembers.userId)).where(inArray(teamChatMembers.chatId, ids))
        : [];
      const authorIds = [...new Set(chats.map((c) => c.lastAuthorId).filter((id): id is string => Boolean(id)))];
      const authors = authorIds.length ? await tx.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, authorIds)) : [];
      const names = new Map(authors.map((a) => [a.id, a.name]));
      return chats.map((chat) => {
        const people = members.filter((m) => m.chatId === chat.id).map(({ userId, name }) => ({ userId, name }));
        const others = people.filter((p) => p.userId !== auth.userId);
        const title = chat.kind === 'general' ? 'General'
          : chat.kind === 'notes' ? 'Mis notas'
            : chat.kind === 'direct' ? (others[0]?.name ?? 'Ex miembro')
              : (chat.title ?? chat.dealTitle ?? others.map((o) => o.name).join(', '));
        return {
          id: chat.id, kind: chat.kind, title, dealId: chat.dealId, dealTitle: chat.dealTitle, members: people,
          unread: Number(chat.unread), lastMessageAt: chat.lastMessageAt,
          lastMessage: chat.lastBody === null ? null : {
            body: chat.lastDeleted ? '' : chat.lastBody, deleted: Boolean(chat.lastDeleted),
            authorName: chat.lastAuthorId === auth.userId ? 'Tú' : (names.get(chat.lastAuthorId ?? '') ?? null),
          },
        };
      });
    });
  }

  /** Un colega → chat directo (siempre el mismo). Varios, un título o un negocio → grupo nuevo. */
  async create(auth: AuthContext, input: z.infer<typeof createChatSchema>) {
    const others = [...new Set(input.userIds)].filter((id) => id !== auth.userId);
    if (!others.length) throw badRequest('Elige al menos a otra persona del equipo');
    const { chat, isNew } = await this.tenant.run(auth, async (tx) => {
      const team = await this.teamIds(tx, auth);
      if (others.some((id) => !team.includes(id))) throw badRequest('Solo puedes chatear con personas de tu equipo');
      if (others.length === 1 && !input.title && !input.dealId) {
        const directKey = [auth.userId, others[0]!].sort().join(':');
        const [existing] = await tx.select().from(teamChats).where(eq(teamChats.directKey, directKey));
        if (existing) return { chat: existing, isNew: false };
        const [chat] = await tx.insert(teamChats).values({ tenantId: auth.tenantId, kind: 'direct', directKey, createdBy: auth.userId }).returning();
        await this.addMembers(tx, auth, chat!.id, [auth.userId, ...others]);
        return { chat: chat!, isNew: true };
      }
      if (input.dealId) {
        const [deal] = await tx.select({ id: deals.id }).from(deals)
          .where(and(eq(deals.id, input.dealId), await this.tenant.visibilityFilter(tx, auth, deals.ownerId)));
        if (!deal) throw new NotFoundException('El negocio no existe');
      }
      const [chat] = await tx.insert(teamChats).values({
        tenantId: auth.tenantId, kind: 'group', title: input.title ?? null, dealId: input.dealId ?? null, createdBy: auth.userId,
      }).returning();
      await this.addMembers(tx, auth, chat!.id, [auth.userId, ...others]);
      return { chat: chat!, isNew: true };
    });
    if (isNew) this.realtime.publishToUsers(auth.tenantId, 'team.message', { chatId: chat.id }, others);
    return (await this.list(auth)).find((c) => c.id === chat.id)!;
  }

  messages(auth: AuthContext, chatId: string, query: z.infer<typeof listMessagesSchema>) {
    return this.tenant.run(auth, async (tx) => {
      await this.findChat(tx, auth, chatId);
      const rows = await tx.select({ message: teamMessages, authorName: user.name }).from(teamMessages)
        .leftJoin(user, eq(user.id, teamMessages.authorId))
        .where(and(eq(teamMessages.chatId, chatId), query.before ? lt(teamMessages.createdAt, new Date(query.before)) : undefined))
        .orderBy(desc(teamMessages.createdAt)).limit(query.limit);
      const now = Date.now();
      return rows.reverse().map(({ message: m, authorName }) => {
        const mine = m.authorId === auth.userId;
        return {
          id: m.id, body: m.deletedAt ? '' : m.body, deleted: Boolean(m.deletedAt), authorId: m.authorId, authorName,
          createdAt: m.createdAt, mine, canDelete: mine && !m.deletedAt && now - m.createdAt.getTime() < DELETE_WINDOW_MS,
        };
      });
    });
  }

  async post(auth: AuthContext, chatId: string, { body }: z.infer<typeof postMessageSchema>) {
    const { message, recipients } = await this.tenant.run(auth, async (tx) => {
      const chat = await this.findChat(tx, auth, chatId);
      const [message] = await tx.insert(teamMessages).values({ tenantId: auth.tenantId, chatId, authorId: auth.userId, body }).returning();
      await tx.update(teamChats).set({ lastMessageAt: message!.createdAt }).where(eq(teamChats.id, chatId));
      await this.markRead(tx, auth, chatId);
      return { message: message!, recipients: await this.recipients(tx, auth, chat) };
    });
    this.realtime.publishToUsers(auth.tenantId, 'team.message', { chatId }, recipients);
    return { id: message.id, body: message.body, deleted: false, authorId: auth.userId, createdAt: message.createdAt, mine: true, canDelete: true };
  }

  async remove(auth: AuthContext, chatId: string, messageId: string) {
    const recipients = await this.tenant.run(auth, async (tx) => {
      const chat = await this.findChat(tx, auth, chatId);
      if (!z.uuid().safeParse(messageId).success) throw new NotFoundException();
      const [message] = await tx.select().from(teamMessages).where(and(eq(teamMessages.id, messageId), eq(teamMessages.chatId, chatId)));
      if (!message || message.deletedAt) throw new NotFoundException();
      if (message.authorId !== auth.userId) throw new ForbiddenException('Solo puedes borrar tus propios mensajes.');
      if (Date.now() - message.createdAt.getTime() >= DELETE_WINDOW_MS) throw new ForbiddenException('Los mensajes se pueden borrar durante la primera hora.');
      await tx.update(teamMessages).set({ deletedAt: sql`now()` }).where(eq(teamMessages.id, messageId));
      return this.recipients(tx, auth, chat);
    });
    this.realtime.publishToUsers(auth.tenantId, 'team.message', { chatId }, recipients);
  }

  read(auth: AuthContext, chatId: string) {
    return this.tenant.run(auth, async (tx) => {
      await this.findChat(tx, auth, chatId);
      await this.markRead(tx, auth, chatId);
    });
  }

  /** El general es de toda la empresa y las notas, de cada persona: se crean la primera vez que se listan. */
  private async ensureBasics(tx: Transaction, auth: AuthContext) {
    await tx.insert(teamChats).values({ tenantId: auth.tenantId, kind: 'general' }).onConflictDoNothing();
    await tx.insert(teamChats).values({ tenantId: auth.tenantId, kind: 'notes', createdBy: auth.userId }).onConflictDoNothing();
  }

  /** 404 también para chats ajenos: no se confirma que existan. */
  private async findChat(tx: Transaction, auth: AuthContext, chatId: string): Promise<Chat> {
    if (!z.uuid().safeParse(chatId).success) throw new NotFoundException();
    const [chat] = await tx.select().from(teamChats).where(eq(teamChats.id, chatId));
    if (!chat) throw new NotFoundException();
    if (chat.kind === 'general') return chat;
    if (chat.kind === 'notes') {
      if (chat.createdBy !== auth.userId) throw new NotFoundException();
      return chat;
    }
    const [member] = await tx.select().from(teamChatMembers).where(and(eq(teamChatMembers.chatId, chatId), eq(teamChatMembers.userId, auth.userId)));
    if (!member) throw new NotFoundException();
    return chat;
  }

  private async markRead(tx: Transaction, auth: AuthContext, chatId: string) {
    await tx.insert(teamChatMembers).values({ tenantId: auth.tenantId, chatId, userId: auth.userId, lastReadAt: new Date() })
      .onConflictDoUpdate({ target: [teamChatMembers.chatId, teamChatMembers.userId], set: { lastReadAt: sql`now()` } });
  }

  /** A quién avisar en vivo: en el general, a todo el equipo; en el resto, a sus miembros. Nunca a quien escribe. */
  private async recipients(tx: Transaction, auth: AuthContext, chat: Chat) {
    if (chat.kind === 'notes') return [];
    const ids = chat.kind === 'general'
      ? await this.teamIds(tx, auth)
      : (await tx.select({ userId: teamChatMembers.userId }).from(teamChatMembers).where(eq(teamChatMembers.chatId, chat.id))).map((m) => m.userId);
    return ids.filter((id) => id !== auth.userId);
  }

  private async teamIds(tx: Transaction, auth: AuthContext) {
    const { rows } = await tx.execute(sql`SELECT "userId" FROM member WHERE "organizationId" = ${auth.tenantId}`);
    return (rows as { userId: string }[]).map((r) => r.userId);
  }

  private async addMembers(tx: Transaction, auth: AuthContext, chatId: string, userIds: string[]) {
    await tx.insert(teamChatMembers).values(userIds.map((userId) => ({ tenantId: auth.tenantId, chatId, userId, lastReadAt: userId === auth.userId ? new Date() : null })));
  }
}
