import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { companies, contacts, deals, savedViews } from '../../../shared/database/schema.js';
import { badRequest } from '../../../shared/http/errors.js';
import { can } from '../../identity/domain/permissions.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { TenantContext } from '../../tenancy/application/tenant-context.js';
import { escapeLike, filterSchema } from '../domain/filters.js';
import { ContactsService } from './contacts.service.js';
import { entitySchema } from './custom-fields.service.js';

export const createViewSchema = z
  .object({ entity: entitySchema, name: z.string().trim().min(1).max(80), filters: filterSchema, shared: z.boolean().default(false) })
  .strict();

/** E02-S06 — Vistas guardadas: personales o compartidas con el equipo. */
@Injectable()
export class ViewsService {
  constructor(
    private readonly tenant: TenantContext,
    private readonly contactsService: ContactsService,
  ) {}

  list(auth: AuthContext, entity: 'contact' | 'deal') {
    return this.tenant.run(auth, (tx) =>
      tx.select().from(savedViews)
        .where(and(eq(savedViews.entity, entity), or(eq(savedViews.shared, true), eq(savedViews.ownerId, auth.userId))))
        .orderBy(asc(savedViews.name)),
    );
  }

  create(auth: AuthContext, input: z.infer<typeof createViewSchema>) {
    if (input.shared && !can(auth.role, 'views:share')) throw new ForbiddenException('Solo propietarios y admins comparten vistas.');
    return this.tenant.run(auth, async (tx) => {
      // Se valida AHORA contra los campos actuales: una vista inválida no se guarda.
      if (input.entity === 'contact') await this.contactsService.compile(tx, input.filters);
      const [row] = await tx.insert(savedViews).values({ ...input, tenantId: auth.tenantId, ownerId: auth.userId }).returning();
      return row!;
    });
  }

  remove(auth: AuthContext, id: string) {
    return this.tenant.run(auth, async (tx) => {
      if (!z.uuid().safeParse(id).success) throw new NotFoundException();
      const [view] = await tx.select().from(savedViews).where(eq(savedViews.id, id));
      if (!view || (!view.shared && view.ownerId !== auth.userId)) throw new NotFoundException();
      if (view.ownerId !== auth.userId && !can(auth.role, 'views:share')) throw new ForbiddenException();
      await tx.delete(savedViews).where(eq(savedViews.id, id));
    });
  }
}

export const searchSchema = z.object({ q: z.string().trim().min(2).max(100) });

/** Con menos letras, la similitud por trigramas encuentra de todo: la tolerancia a errores no aplica. */
const FUZZY_MIN_LENGTH = 4;

/**
 * E02-S07 — Búsqueda global sin tildes ni mayúsculas. Cada palabra es un LIKE sobre la
 * columna `search` (índice trigram); todas deben aparecer. Respeta la visibilidad del vendedor.
 * E02-S10 — Un teléfono escrito con guiones o paréntesis se busca por sus dígitos y, si nada coincide
 * exacto, se toleran errores de escritura ("Gomes" encuentra a Gómez) con similitud por palabra (pg_trgm).
 */
@Injectable()
export class SearchService {
  constructor(private readonly tenant: TenantContext) {}

  search(auth: AuthContext, q: string) {
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 5);
    if (!terms.length) throw badRequest('Búsqueda vacía');
    const text = q.trim();
    const digits = text.replace(/\D/g, '');
    type Column = Parameters<typeof sql>[1];
    const like = (column: Column) =>
      and(...terms.map((t) => sql`${column} LIKE '%' || lower(f_unaccent(${escapeLike(t)})) || '%'`));
    const exact = (column: Column) =>
      or(like(column), digits.length >= 4 && digits !== text ? sql`${column} LIKE '%' || ${digits} || '%'` : undefined);
    const typo = (column: Column) => sql`lower(f_unaccent(${text})) <% ${column}`;
    const closeness = (column: Column) => desc(sql`word_similarity(lower(f_unaccent(${text})), ${column})`);
    const dealTitle = sql`lower(f_unaccent(${deals.title}))`;

    return this.tenant.run(auth, async (tx) => {
      const visibleContacts = await this.tenant.visibilityFilter(tx, auth, contacts.ownerId);
      const visibleDeals = await this.tenant.visibilityFilter(tx, auth, deals.ownerId);
      const find = (fuzzy: boolean) => Promise.all([
        tx.select({ id: contacts.id, name: contacts.name, phone: contacts.phone, email: contacts.email })
          .from(contacts).where(and(fuzzy ? typo(contacts.search) : exact(contacts.search), visibleContacts))
          .orderBy(fuzzy ? closeness(contacts.search) : asc(contacts.name)).limit(10),
        tx.select({ id: companies.id, name: companies.name })
          .from(companies).where(fuzzy ? typo(companies.search) : like(companies.search))
          .orderBy(fuzzy ? closeness(companies.search) : asc(companies.name)).limit(5),
        tx.select({ id: deals.id, title: deals.title, status: deals.status })
          .from(deals).where(and(fuzzy ? typo(dealTitle) : like(dealTitle), visibleDeals))
          .orderBy(fuzzy ? closeness(dealTitle) : asc(deals.title)).limit(5),
      ]);
      let [foundContacts, foundCompanies, foundDeals] = await find(false);
      const nothing = !foundContacts.length && !foundCompanies.length && !foundDeals.length;
      if (nothing && text.length >= FUZZY_MIN_LENGTH) [foundContacts, foundCompanies, foundDeals] = await find(true);
      return { contacts: foundContacts, companies: foundCompanies, deals: foundDeals };
    });
  }
}
