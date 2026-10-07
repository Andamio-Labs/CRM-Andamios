import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Transaction } from '../../../shared/database/database.js';
import { companies, contactCompanies, contacts } from '../../../shared/database/schema.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { TenantContext } from '../../tenancy/application/tenant-context.js';
import { ContactsService } from './contacts.service.js';

export const companySchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    domain: z.string().trim().toLowerCase().max(120).regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Dominio inválido').nullish(),
  })
  .strict();
export const linkSchema = z.object({ jobTitle: z.string().trim().max(120).nullish() }).strict();

const columns = { id: companies.id, name: companies.name, domain: companies.domain, createdAt: companies.createdAt };

/** E02-S03 — Organizaciones del cliente y vínculo N a N con contactos. */
@Injectable()
export class CompaniesService {
  constructor(
    private readonly tenant: TenantContext,
    private readonly contactsService: ContactsService,
  ) {}

  list(auth: AuthContext) {
    return this.tenant.run(auth, (tx) => tx.select(columns).from(companies).orderBy(asc(companies.name)).limit(200));
  }

  create(auth: AuthContext, input: z.infer<typeof companySchema>) {
    return this.tenant.run(auth, async (tx) => {
      const [row] = await tx.insert(companies).values({ ...input, tenantId: auth.tenantId, ownerId: auth.userId }).returning(columns);
      return row!;
    });
  }

  get(auth: AuthContext, id: string) {
    return this.tenant.run(auth, async (tx) => {
      const company = await this.find(tx, id);
      // Los contactos listados respetan la visibilidad del vendedor.
      const people = await tx
        .select({ id: contacts.id, name: contacts.name, jobTitle: contactCompanies.jobTitle })
        .from(contactCompanies).innerJoin(contacts, eq(contacts.id, contactCompanies.contactId))
        .where(and(eq(contactCompanies.companyId, id), await this.tenant.visibilityFilter(tx, auth, contacts.ownerId)));
      return { ...company, contacts: people };
    });
  }

  update(auth: AuthContext, id: string, input: Partial<z.infer<typeof companySchema>>) {
    return this.tenant.run(auth, async (tx) => {
      const [row] = await tx.update(companies).set(input).where(eq(companies.id, id)).returning(columns);
      if (!row) throw new NotFoundException();
      return row;
    });
  }

  remove(auth: AuthContext, id: string) {
    return this.tenant.run(auth, async (tx) => {
      await this.find(tx, id);
      await tx.delete(companies).where(eq(companies.id, id));
    });
  }

  link(auth: AuthContext, companyId: string, contactId: string, input: z.infer<typeof linkSchema>) {
    return this.tenant.run(auth, async (tx) => {
      await this.find(tx, companyId);
      await this.contactsService.findVisible(tx, auth, contactId);
      await tx
        .insert(contactCompanies)
        .values({ tenantId: auth.tenantId, companyId, contactId, jobTitle: input.jobTitle ?? null })
        .onConflictDoUpdate({ target: [contactCompanies.contactId, contactCompanies.companyId], set: { jobTitle: sql`excluded.job_title` } });
    });
  }

  unlink(auth: AuthContext, companyId: string, contactId: string) {
    return this.tenant.run(auth, async (tx) => {
      await this.contactsService.findVisible(tx, auth, contactId);
      await tx.delete(contactCompanies).where(and(eq(contactCompanies.companyId, companyId), eq(contactCompanies.contactId, contactId)));
    });
  }

  private async find(tx: Transaction, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    const [row] = await tx.select(columns).from(companies).where(eq(companies.id, id));
    if (!row) throw new NotFoundException();
    return row;
  }
}
