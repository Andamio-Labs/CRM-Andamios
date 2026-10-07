import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, lt, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Transaction } from '../../../shared/database/database.js';
import { auditLog, companies, contactCompanies, contacts, savedViews } from '../../../shared/database/schema.js';
import { badRequest } from '../../../shared/http/errors.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { createSystemDeal } from '../../pipeline/application/pipelines.service.js';
import { TenantContext } from '../../tenancy/application/tenant-context.js';
import { InvalidCustomFieldError, validateCustomFieldValues } from '../domain/custom-fields.js';
import { compileFilter, type FieldCatalog, type Filter, filterSchema, InvalidFilterError } from '../domain/filters.js';
import { countryFromLocale, InvalidPhoneError, normalizePhone } from '../domain/phone.js';
import { CustomFieldsService } from './custom-fields.service.js';

const tags = z.array(z.string().trim().min(1).max(40)).max(30).transform((t) => [...new Set(t)]);

export const createContactSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    phone: z.string().trim().max(40).nullish(),
    email: z.email().trim().toLowerCase().nullish(),
    tags: tags.default([]),
    notes: z.string().max(5000).nullish(),
    ownerId: z.string().max(64).nullish(),
    customFields: z.record(z.string(), z.unknown()).default({}),
    source: z.string().trim().max(60).nullish(),
    campaign: z.string().trim().max(120).nullish(),
    priority: z.enum(['critical', 'high', 'medium', 'low']).nullish(),
    kind: z.enum(['person', 'company']).optional(),
  })
  .strict();
export const updateContactSchema = createContactSchema.partial().strict();
/** Alta: además puede crear su negocio (X-07) y forzar un duplicado consciente (E02-S02). */
export const createContactRequestSchema = createContactSchema.extend({
  createDeal: z.object({ pipelineId: z.uuid() }).strict().optional(),
  allowDuplicate: z.boolean().optional(),
}).strict();

export const listContactsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
  filter: z.string().max(5000).optional(),
  viewId: z.uuid().optional(),
  mine: z.stringbool().optional(),
});

export const CONTACT_FIELDS: FieldCatalog = {
  name: { kind: 'text', column: sql`${contacts.name}` },
  email: { kind: 'text', column: sql`${contacts.email}::text` },
  phone: { kind: 'text', column: sql`${contacts.phone}` },
  tags: { kind: 'tags', column: sql`${contacts.tags}` },
  ownerId: { kind: 'id', column: sql`${contacts.ownerId}` },
  source: { kind: 'text', column: sql`${contacts.source}` },
  priority: { kind: 'select', column: sql`${contacts.priority}` },
  kind: { kind: 'select', column: sql`${contacts.kind}` },
  createdAt: { kind: 'date', column: sql`(${contacts.createdAt})::date` },
};

const columns = {
  id: contacts.id, name: contacts.name, phone: contacts.phone, email: contacts.email, tags: contacts.tags, notes: contacts.notes,
  customFields: contacts.customFields, ownerId: contacts.ownerId, createdAt: contacts.createdAt, updatedAt: contacts.updatedAt,
  whatsappOptInAt: contacts.whatsappOptInAt, whatsappOptInSource: contacts.whatsappOptInSource, whatsappOptOutAt: contacts.whatsappOptOutAt,
  source: contacts.source, campaign: contacts.campaign, priority: contacts.priority, kind: contacts.kind,
};

/** E02-S01 — Contactos, con visibilidad por rol (E01-S04) y filtros (E02-S06). */
@Injectable()
export class ContactsService {
  constructor(
    private readonly tenant: TenantContext,
    private readonly fields: CustomFieldsService,
  ) {}

  async list(auth: AuthContext, query: z.infer<typeof listContactsSchema>) {
    return this.tenant.run(auth, async (tx) => {
      const where: (SQL | undefined)[] = [await this.tenant.visibilityFilter(tx, auth, contacts.ownerId), query.mine ? eq(contacts.ownerId, auth.userId) : undefined];
      const filter = query.viewId ? await this.viewFilter(tx, auth, query.viewId) : query.filter ? parseFilter(query.filter) : undefined;
      if (filter) where.push(await this.compile(tx, filter));
      if (query.cursor) {
        const [at, id] = decodeCursor(query.cursor);
        where.push(or(lt(contacts.createdAt, at), and(eq(contacts.createdAt, at), lt(contacts.id, id))));
      }
      const rows = await tx.select(columns).from(contacts).where(and(...where))
        .orderBy(desc(contacts.createdAt), desc(contacts.id)).limit(query.limit + 1);
      const items = rows.slice(0, query.limit);
      const last = items.at(-1);
      return { items, nextCursor: rows.length > query.limit && last ? encodeCursor(last.createdAt, last.id) : null };
    });
  }

  async get(auth: AuthContext, id: string) {
    return this.tenant.run(auth, async (tx) => {
      const contact = await this.findVisible(tx, auth, id);
      const linked = await tx
        .select({ id: companies.id, name: companies.name, jobTitle: contactCompanies.jobTitle })
        .from(contactCompanies).innerJoin(companies, eq(companies.id, contactCompanies.companyId))
        .where(eq(contactCompanies.contactId, id));
      return { ...contact, companies: linked };
    });
  }

  async create(auth: AuthContext, request: z.infer<typeof createContactRequestSchema>) {
    const { createDeal, allowDuplicate, ...input } = request;
    return this.tenant.run(auth, async (tx) => {
      const values = await this.prepare(tx, auth, input, {});
      if (!allowDuplicate) {
        const restricted = (await this.tenant.visibility(tx, auth)) === 'assigned';
        // Un vendedor con "solo lo suyo" se entera de que existe, pero no de quién es si no es suyo.
        const duplicates = (await this.findDuplicates(tx, values.phone ?? null, values.email ?? null))
          .map(({ ownerId, ...d }) => (restricted && ownerId !== auth.userId ? { ...d, name: 'Contacto de otro vendedor' } : d));
        if (duplicates.length) {
          throw new ConflictException({ code: 'DUPLICATE_CONTACT', message: 'Ya existe un contacto con ese teléfono o correo.', duplicates });
        }
      }
      const [row] = await tx.insert(contacts)
        .values({ ...values, name: input.name, tenantId: auth.tenantId, createdBy: auth.userId, ownerId: values.ownerId ?? auth.userId })
        .returning(columns);
      if (createDeal) {
        await this.pipelineVisible(tx, createDeal.pipelineId);
        await createSystemDeal(tx, auth.tenantId, { title: row!.name, contactId: row!.id, source: row!.source, pipelineId: createDeal.pipelineId, ownerId: row!.ownerId, actorId: auth.userId });
      }
      return row!;
    });
  }

  /** E02-S02 — Mismo teléfono (E.164) o mismo correo dentro del tenant. */
  async findDuplicates(tx: Transaction, phone: string | null, email: string | null, excludeId?: string) {
    if (!phone && !email) return [];
    const rows = await tx.select({ id: contacts.id, name: contacts.name, phone: contacts.phone, email: contacts.email, ownerId: contacts.ownerId }).from(contacts)
      .where(and(or(phone ? eq(contacts.phone, phone) : undefined, email ? sql`${contacts.email} = ${email}::citext` : undefined), excludeId ? sql`${contacts.id} <> ${excludeId}` : undefined))
      .limit(5);
    return rows.map((r) => ({ id: r.id, name: r.name, ownerId: r.ownerId, matchedBy: phone && r.phone === phone ? 'phone' : 'email' }));
  }

  /**
   * E02-S02 — Fusiona `duplicateId` en `id`: completa los datos vacíos, une etiquetas y mueve
   * negocios, tareas, organizaciones y conversaciones (si ambos hablaron por el mismo número,
   * los mensajes pasan a una sola conversación). Todo en una transacción y queda en auditoría.
   */
  async merge(auth: AuthContext, id: string, duplicateId: string) {
    if (id === duplicateId) throw badRequest('No se puede fusionar un contacto consigo mismo');
    return this.tenant.run(auth, async (tx) => {
      const primary = await this.findVisible(tx, auth, id);
      const dup = await this.findVisible(tx, auth, duplicateId);
      const fill = <K extends keyof typeof primary>(k: K) => primary[k] ?? dup[k];
      await tx.update(contacts).set({
        phone: fill('phone'), email: fill('email'), notes: fill('notes'), source: fill('source'), campaign: fill('campaign'),
        priority: fill('priority'), ownerId: fill('ownerId'), tags: [...new Set([...primary.tags, ...dup.tags])],
        customFields: { ...dup.customFields, ...primary.customFields }, updatedAt: sql`now()`,
      }).where(eq(contacts.id, id));

      await tx.execute(sql`UPDATE deals SET contact_id = ${id} WHERE contact_id = ${duplicateId}`);
      await tx.execute(sql`UPDATE tasks SET contact_id = ${id} WHERE contact_id = ${duplicateId}`);
      await tx.execute(sql`INSERT INTO contact_companies (tenant_id, contact_id, company_id, job_title)
        SELECT tenant_id, ${id}, company_id, job_title FROM contact_companies WHERE contact_id = ${duplicateId} ON CONFLICT DO NOTHING`);
      // Conversaciones por el mismo número: se unifican en la del principal.
      await tx.execute(sql`
        WITH pairs AS (
          SELECT d.id AS dup_conv, p.id AS primary_conv FROM conversations d
          JOIN conversations p ON p.channel_id = d.channel_id AND p.contact_id = ${id}
          WHERE d.contact_id = ${duplicateId}
        ), moved AS (
          UPDATE messages m SET conversation_id = pairs.primary_conv FROM pairs WHERE m.conversation_id = pairs.dup_conv RETURNING pairs.primary_conv
        )
        UPDATE conversations c SET
          last_inbound_at = greatest(c.last_inbound_at, d.last_inbound_at),
          last_message_at = greatest(c.last_message_at, d.last_message_at),
          unread_count = c.unread_count + d.unread_count
        FROM conversations d JOIN pairs ON pairs.dup_conv = d.id WHERE c.id = pairs.primary_conv`);
      await tx.execute(sql`DELETE FROM conversations WHERE contact_id = ${duplicateId}
        AND channel_id IN (SELECT channel_id FROM conversations WHERE contact_id = ${id})`);
      await tx.execute(sql`UPDATE conversations SET contact_id = ${id} WHERE contact_id = ${duplicateId}`);
      await tx.delete(contacts).where(eq(contacts.id, duplicateId));
      await tx.insert(auditLog).values({ tenantId: auth.tenantId, actorId: auth.userId, action: 'merge', entity: 'contact', entityId: id, data: { merged: duplicateId, name: dup.name } });
      return this.findVisible(tx, auth, id);
    });
  }

  /** X-07 — Barra de estadísticas de la lista de clientes (respeta visibilidad). */
  stats(auth: AuthContext) {
    return this.tenant.run(auth, async (tx) => {
      const visible = await this.tenant.visibilityFilter(tx, auth, contacts.ownerId);
      const [totalsRows, topRows] = await Promise.all([
        tx.select({ total: sql<number>`count(*)::int`, withPhone: sql<number>`count(${contacts.phone})::int` }).from(contacts).where(visible),
        tx.select({ source: sql<string>`coalesce(${contacts.source}, 'sin_origen')`, count: sql<number>`count(*)::int` })
          .from(contacts).where(visible).groupBy(sql`1`).orderBy(sql`2 DESC`).limit(1),
      ]);
      const [totals] = totalsRows;
      const [top] = topRows;
      return { total: totals!.total, withPhone: totals!.withPhone, topSource: top ?? null };
    });
  }

  private async pipelineVisible(tx: Transaction, pipelineId: string) {
    const { rows } = await tx.execute(sql`SELECT 1 FROM pipelines WHERE id = ${pipelineId}`);
    if (!rows.length) throw new NotFoundException('El embudo no existe');
  }

  async update(auth: AuthContext, id: string, input: z.infer<typeof updateContactSchema>) {
    return this.tenant.run(auth, async (tx) => {
      const current = await this.findVisible(tx, auth, id);
      const values = await this.prepare(tx, auth, input, current.customFields);
      const [row] = await tx.update(contacts).set({ ...values, updatedAt: sql`now()` }).where(eq(contacts.id, id)).returning(columns);
      return row!;
    });
  }

  async remove(auth: AuthContext, id: string) {
    await this.tenant.run(auth, async (tx) => {
      await this.findVisible(tx, auth, id);
      await tx.delete(contacts).where(eq(contacts.id, id));
    });
  }

  /** 404 tanto si no existe como si es de otro tenant o no está asignado al vendedor: no confirmamos existencia. */
  async findVisible(tx: Transaction, auth: AuthContext, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    const [row] = await tx.select(columns).from(contacts)
      .where(and(eq(contacts.id, id), await this.tenant.visibilityFilter(tx, auth, contacts.ownerId)));
    if (!row) throw new NotFoundException();
    return row;
  }

  async compile(tx: Transaction, filter: Filter) {
    try {
      return compileFilter(filter, CONTACT_FIELDS, await this.fields.definitions(tx, 'contact'), sql`${contacts.customFields}`);
    } catch (error) {
      if (error instanceof InvalidFilterError) throw badRequest(error.message);
      throw error;
    }
  }

  private async viewFilter(tx: Transaction, auth: AuthContext, viewId: string): Promise<Filter> {
    const [view] = await tx.select({ filters: savedViews.filters }).from(savedViews)
      .where(and(eq(savedViews.id, viewId), eq(savedViews.entity, 'contact'), or(eq(savedViews.shared, true), eq(savedViews.ownerId, auth.userId))));
    if (!view) throw new NotFoundException('La vista no existe');
    return filterSchema.parse(view.filters);
  }

  private async prepare(tx: Transaction, auth: AuthContext, input: z.infer<typeof updateContactSchema>, currentCustom: Record<string, unknown>) {
    const { customFields, phone, ...rest } = input;
    const out: Partial<typeof contacts.$inferInsert> = { ...rest };
    if (phone !== undefined) {
      try {
        out.phone = phone ? normalizePhone(phone, countryFromLocale((await this.tenant.settings(tx)).locale)) : null;
      } catch (error) {
        if (error instanceof InvalidPhoneError) throw badRequest(error.message);
        throw error;
      }
    }
    if (input.ownerId) await this.tenant.assertMember(tx, auth, input.ownerId);
    if (customFields && Object.keys(customFields).length) {
      try {
        const validated = validateCustomFieldValues(await this.fields.definitions(tx, 'contact'), customFields);
        const merged = { ...currentCustom, ...validated };
        out.customFields = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== null)) as typeof out.customFields;
      } catch (error) {
        if (error instanceof InvalidCustomFieldError) throw badRequest(error.message);
        throw error;
      }
    }
    return out;
  }
}

export function parseFilter(raw: string): Filter {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw badRequest('El filtro no es JSON válido');
  }
  const parsed = filterSchema.safeParse(json);
  if (!parsed.success) throw badRequest('El filtro no tiene el formato esperado');
  return parsed.data;
}

const encodeCursor = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
function decodeCursor(cursor: string): [Date, string] {
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const date = new Date(at ?? '');
  if (Number.isNaN(date.getTime()) || !z.uuid().safeParse(id).success) throw badRequest('Cursor inválido');
  return [date, id!];
}
