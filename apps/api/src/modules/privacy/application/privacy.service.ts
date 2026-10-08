import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Transaction } from '../../../shared/database/database.js';
import {
  auditLog, companies, contactCompanies, contactConsents, contacts, conversations, deals, messages, privacyRequests, tasks,
} from '../../../shared/database/schema.js';
import { AppError } from '../../../shared/http/app-error.js';
import type { ObjectStorage } from '../../../shared/storage/object-storage.js';
import { STORAGE } from '../../../shared/tokens.js';
import { ContactsService } from '../../contacts/application/contacts.service.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { TenantContext } from '../../tenancy/application/tenant-context.js';
import { legalDeadline, REQUEST_TYPES } from '../domain/deadlines.js';

export const createRequestSchema = z.object({
  contactId: z.uuid(),
  type: z.enum(REQUEST_TYPES),
  channel: z.enum(['whatsapp', 'web_form', 'phone', 'email', 'in_person']),
  details: z.string().trim().max(2000).nullish(),
}).strict();
export const resolveRequestSchema = z.object({ status: z.enum(['resolved', 'rejected']), resolution: z.string().trim().min(3).max(2000) }).strict();
export const listRequestsSchema = z.object({ status: z.enum(['open', 'resolved', 'rejected', 'all']).default('open') });
export const eraseSchema = z.object({ confirm: z.literal(true), requestId: z.uuid().optional() }).strict();

export const ERASED_NAME = 'Titular suprimido';

/** E13-S03 — Derechos del titular (Ley 1581): solicitudes con plazo, exportación y supresión. */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly tenant: TenantContext,
    private readonly contactsService: ContactsService,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  listRequests(auth: AuthContext, { status }: z.infer<typeof listRequestsSchema>) {
    return this.tenant.run(auth, (tx) => tx.select({ request: privacyRequests, contactName: contacts.name })
      .from(privacyRequests).leftJoin(contacts, eq(contacts.id, privacyRequests.contactId))
      .where(status === 'all' ? undefined : eq(privacyRequests.status, status))
      .orderBy(asc(privacyRequests.dueAt)).limit(200)
      .then((rows) => rows.map(({ request: { tenantId: _t, ...r }, contactName }) => ({ ...r, contactName }))));
  }

  createRequest(auth: AuthContext, input: z.infer<typeof createRequestSchema>) {
    return this.tenant.run(auth, async (tx) => {
      await this.contactsService.findVisible(tx, auth, input.contactId);
      const [row] = await tx.insert(privacyRequests).values({
        tenantId: auth.tenantId, contactId: input.contactId, type: input.type, channel: input.channel,
        details: input.details ?? null, dueAt: legalDeadline(input.type, new Date()), createdBy: auth.userId,
      }).returning();
      const { tenantId: _t, ...request } = row!;
      return request;
    });
  }

  resolveRequest(auth: AuthContext, id: string, input: z.infer<typeof resolveRequestSchema>) {
    return this.tenant.run(auth, async (tx) => {
      if (!z.uuid().safeParse(id).success) throw new NotFoundException();
      const [current] = await tx.select().from(privacyRequests).where(eq(privacyRequests.id, id));
      if (!current) throw new NotFoundException();
      const row = await this.close(tx, auth, id, input.status, input.resolution);
      if (!row) throw new AppError(HttpStatus.CONFLICT, 'REQUEST_ALREADY_CLOSED', 'La solicitud ya está cerrada');
      const { tenantId: _t, ...request } = row;
      return request;
    });
  }

  /** Todo lo que hay del titular, en un JSON que se le puede entregar tal cual. */
  exportPersonalData(auth: AuthContext, contactId: string) {
    return this.tenant.run(auth, async (tx) => {
      const contact = await this.contactsService.findVisible(tx, auth, contactId);
      const [orgs, contactDeals, contactTasks, convs, consents, requests] = await Promise.all([
        tx.select({ name: companies.name, domain: companies.domain, jobTitle: contactCompanies.jobTitle })
          .from(contactCompanies).innerJoin(companies, eq(companies.id, contactCompanies.companyId)).where(eq(contactCompanies.contactId, contactId)),
        tx.select({ id: deals.id, title: deals.title, value: deals.value, currency: deals.currency, status: deals.status, description: deals.description, createdAt: deals.createdAt, closedAt: deals.closedAt })
          .from(deals).where(eq(deals.contactId, contactId)),
        tx.select({ title: tasks.title, description: tasks.description, status: tasks.status, dueAt: tasks.dueAt, createdAt: tasks.createdAt })
          .from(tasks).where(eq(tasks.contactId, contactId)),
        tx.select({ id: conversations.id, createdAt: conversations.createdAt }).from(conversations).where(eq(conversations.contactId, contactId)),
        tx.select({ legalBasis: contactConsents.legalBasis, purposes: contactConsents.purposes, granted: contactConsents.granted, channel: contactConsents.channel, evidence: contactConsents.evidence, recordedAt: contactConsents.recordedAt })
          .from(contactConsents).where(eq(contactConsents.contactId, contactId)).orderBy(asc(contactConsents.recordedAt)),
        tx.select({ type: privacyRequests.type, status: privacyRequests.status, createdAt: privacyRequests.createdAt, resolvedAt: privacyRequests.resolvedAt })
          .from(privacyRequests).where(eq(privacyRequests.contactId, contactId)),
      ]);
      const allMessages = convs.length
        ? await tx.select({ conversationId: messages.conversationId, direction: messages.direction, type: messages.type, body: messages.body, createdAt: messages.createdAt })
          .from(messages).where(and(inArray(messages.conversationId, convs.map((c) => c.id)), or(eq(messages.direction, 'in'), eq(messages.direction, 'out'))))
          .orderBy(asc(messages.createdAt))
        : [];
      await tx.insert(auditLog).values({ tenantId: auth.tenantId, actorId: auth.userId, action: 'export', entity: 'personal_data', entityId: contactId });
      return {
        generatedAt: new Date().toISOString(),
        contact,
        organizations: orgs,
        deals: contactDeals,
        tasks: contactTasks,
        conversations: convs.map((c) => ({ ...c, messages: allMessages.filter((m) => m.conversationId === c.id).map(({ conversationId: _c, ...m }) => m) })),
        consents,
        privacyRequests: requests,
      };
    });
  }

  /**
   * Supresión: el contacto queda anonimizado (no se borra, para no romper negocios ni reportes),
   * se borran tareas, conversaciones, mensajes y archivos. Se conserva el historial de consentimiento:
   * es la prueba de cumplimiento que exige la misma ley.
   */
  async erase(auth: AuthContext, contactId: string, { requestId }: z.infer<typeof eraseSchema>) {
    const mediaKeys = await this.tenant.run(auth, async (tx) => {
      const contact = await this.contactsService.findVisible(tx, auth, contactId);
      const { rows } = await tx.execute<{ key: string }>(sql`
        SELECT m.media->>'key' AS key FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE c.contact_id = ${contactId} AND m.media->>'key' IS NOT NULL`);

      await tx.delete(conversations).where(eq(conversations.contactId, contactId)); // los mensajes caen en cascada
      await tx.delete(tasks).where(eq(tasks.contactId, contactId));
      await tx.delete(contactCompanies).where(eq(contactCompanies.contactId, contactId));
      await tx.update(deals).set({
        title: sql`replace(${deals.title}, ${contact.name}, ${ERASED_NAME})`, description: null, closeNote: null, customFields: {}, updatedAt: new Date(),
      }).where(eq(deals.contactId, contactId));
      await tx.update(contacts).set({
        name: ERASED_NAME, phone: null, email: null, notes: null, tags: [], customFields: {}, campaign: null, updatedAt: new Date(),
      }).where(eq(contacts.id, contactId));
      if (requestId) await this.close(tx, auth, requestId, 'resolved', 'Datos suprimidos desde la plataforma', contactId);
      await tx.insert(auditLog).values({ tenantId: auth.tenantId, actorId: auth.userId, action: 'erase', entity: 'personal_data', entityId: contactId, data: { files: rows.length } });
      return rows.map((r) => r.key);
    });
    for (const key of mediaKeys) {
      await this.storage.delete(key).catch((error: Error) => this.logger.error(`No se pudo borrar ${key}: ${error.message}`));
    }
    return { erased: true, filesDeleted: mediaKeys.length };
  }

  private async close(tx: Transaction, auth: AuthContext, id: string, status: 'resolved' | 'rejected', resolution: string, contactId?: string) {
    const [row] = await tx.update(privacyRequests).set({ status, resolution, resolvedBy: auth.userId, resolvedAt: new Date() })
      .where(and(eq(privacyRequests.id, id), eq(privacyRequests.status, 'open'), contactId ? eq(privacyRequests.contactId, contactId) : undefined))
      .returning();
    return row;
  }
}

