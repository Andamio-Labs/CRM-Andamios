import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Transaction } from '../../../shared/database/database.js';
import { contactConsents } from '../../../shared/database/schema.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { TenantContext } from '../../tenancy/application/tenant-context.js';
import { CONSENT_CHANNELS, currentConsents, LEGAL_BASES, PURPOSES } from '../domain/consent.js';
import { ContactsService } from './contacts.service.js';

export const recordConsentSchema = z.object({
  legalBasis: z.enum(LEGAL_BASES),
  purposes: z.array(z.enum(PURPOSES)).min(1).max(PURPOSES.length).transform((p) => [...new Set(p)]),
  granted: z.boolean(),
  channel: z.enum(CONSENT_CHANNELS),
  evidence: z.string().trim().max(1000).nullish(),
}).strict();

type ConsentRow = typeof contactConsents.$inferSelect;
const view = ({ tenantId: _t, contactId: _c, ...row }: ConsentRow) => row;

/** Inserta un registro en el historial. Lo usan también la bandeja (BAJA/ALTA) y el consentimiento manual de WhatsApp. */
export async function recordConsent(tx: Transaction, values: typeof contactConsents.$inferInsert) {
  const [row] = await tx.insert(contactConsents).values(values).returning();
  return row!;
}

/** E13-S02 — Base legal, finalidad y fecha del consentimiento de cada contacto. */
@Injectable()
export class ConsentsService {
  constructor(
    private readonly tenant: TenantContext,
    private readonly contactsService: ContactsService,
  ) {}

  list(auth: AuthContext, contactId: string) {
    return this.tenant.run(auth, async (tx) => {
      await this.contactsService.findVisible(tx, auth, contactId);
      const history = await tx.select().from(contactConsents)
        .where(eq(contactConsents.contactId, contactId)).orderBy(desc(contactConsents.recordedAt), desc(contactConsents.id));
      const views = history.map(view);
      return { current: currentConsents(views), history: views };
    });
  }

  record(auth: AuthContext, contactId: string, input: z.infer<typeof recordConsentSchema>) {
    return this.tenant.run(auth, async (tx) => {
      await this.contactsService.findVisible(tx, auth, contactId);
      return view(await recordConsent(tx, { ...input, evidence: input.evidence ?? null, tenantId: auth.tenantId, contactId, recordedBy: auth.userId }));
    });
  }
}
