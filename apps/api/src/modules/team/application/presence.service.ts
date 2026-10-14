import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Transaction } from '../../../shared/database/database.js';
import { memberPresence, type PresenceStatus, tenantSettings } from '../../../shared/database/schema.js';
import { withTenant } from '../../../shared/database/with-tenant.js';
import { RealtimeGateway } from '../../../shared/realtime/realtime.gateway.js';
import { DB } from '../../../shared/tokens.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { effectivePresence, PRESENCE_DURATIONS, PRESENCE_STATUSES } from '../domain/presence.js';

export const setPresenceSchema = z
  .object({ status: z.enum(PRESENCE_STATUSES), duration: z.enum(PRESENCE_DURATIONS).default('until_changed') })
  .strict();
export type SetPresenceInput = z.infer<typeof setPresenceSchema>;

export interface PresenceView {
  userId: string;
  name: string;
  status: PresenceStatus;
  /** Hasta cuándo dura el estado elegido; null = hasta que lo cambie. */
  until: Date | null;
}

interface PresenceRow {
  userId: string;
  name: string;
  status: PresenceStatus | null;
  until: Date | string | null;
  hasSession: boolean;
}

/** E01-S09 — Estado del empleado: en línea, en visita, no molestar o desconectado. */
@Injectable()
export class PresenceService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly realtime: RealtimeGateway,
  ) {}

  list(auth: AuthContext) {
    return withTenant(this.db, auth.tenantId, (tx) => this.team(tx, auth.tenantId));
  }

  /**
   * Estado efectivo de cada miembro del tenant activo de `tx`. Con el nombre: es también el directorio
   * del equipo para quien no puede ver la gestión de miembros (el vendedor invita colegas a una reunión).
   */
  async team(tx: Transaction, tenantId: string): Promise<PresenceView[]> {
    const { rows } = await tx.execute(sql`
      SELECT m."userId" AS "userId", u.name, p.status, p.until,
             EXISTS (SELECT 1 FROM session s WHERE s."userId" = m."userId" AND s."expiresAt" > now()) AS "hasSession"
      FROM member m JOIN "user" u ON u.id = m."userId" LEFT JOIN member_presence p ON p.user_id = m."userId"
      WHERE m."organizationId" = ${tenantId} ORDER BY u.name`);
    const now = new Date();
    return (rows as unknown as PresenceRow[]).map((row) => {
      const stored = row.status ? { status: row.status, until: row.until ? new Date(row.until) : null } : undefined;
      const status = effectivePresence(stored, row.hasSession, now);
      return { userId: row.userId, name: row.name, status, until: stored && stored.status === status ? stored.until : null };
    });
  }

  async set(auth: AuthContext, input: SetPresenceInput): Promise<PresenceView> {
    const view = await withTenant(this.db, auth.tenantId, async (tx) => {
      const [settings] = await tx.select({ timezone: tenantSettings.timezone }).from(tenantSettings);
      const timezone = settings?.timezone ?? 'America/Bogota';
      // "Hasta el fin del día" es la medianoche en la zona de la empresa, no la del servidor.
      const until = input.status === 'online' || input.duration === 'until_changed'
        ? null
        : input.duration === '1h'
          ? sql`now() + interval '1 hour'`
          : sql`(date_trunc('day', now() AT TIME ZONE ${timezone}) + interval '1 day') AT TIME ZONE ${timezone}`;
      await tx.insert(memberPresence)
        .values({ tenantId: auth.tenantId, userId: auth.userId, status: input.status, until })
        .onConflictDoUpdate({
          target: [memberPresence.tenantId, memberPresence.userId],
          set: { status: input.status, until, updatedAt: sql`now()` },
        });
      return (await this.team(tx, auth.tenantId)).find((p) => p.userId === auth.userId)!;
    });
    this.realtime.publish(auth.tenantId, 'presence.changed', view, auth.userId);
    return view;
  }
}
