import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { contacts } from '../../../shared/database/schema.js';
import { badRequest } from '../../../shared/http/errors.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { TenantContext } from '../../tenancy/application/tenant-context.js';
import { ContactsService } from './contacts.service.js';

export const timelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(300).optional(),
});
export const consentSchema = z.object({ optIn: z.boolean(), source: z.string().trim().min(2).max(60).regex(/^[a-z0-9_]+$/, 'Origen en minúsculas con _') }).strict();

interface TimelineItem {
  kind: 'message' | 'note' | 'deal';
  id: string;
  at: Date;
  summary: string;
  data: Record<string, unknown>;
}

/**
 * E02-S05 — Línea de tiempo del contacto: mensajes, notas y cambios de negocio en un solo
 * orden cronológico. Llamadas (E12) y tareas (E06) se suman como nuevas ramas del UNION.
 * Paginación por cursor (fecha, clave) estable aunque lleguen eventos nuevos.
 */
@Injectable()
export class TimelineService {
  constructor(
    private readonly tenant: TenantContext,
    private readonly contactsService: ContactsService,
  ) {}

  timeline(auth: AuthContext, contactId: string, { limit, cursor }: z.infer<typeof timelineQuerySchema>) {
    return this.tenant.run(auth, async (tx) => {
      await this.contactsService.findVisible(tx, auth, contactId);
      const [cursorAt, cursorKey] = cursor ? decode(cursor) : [null, null];
      const { rows } = await tx.execute(sql`
        SELECT kind, id, at, summary, data FROM (
          SELECT CASE WHEN m.direction = 'note' THEN 'note' ELSE 'message' END AS kind, m.id::text AS id, m.created_at AS at,
                 coalesce(m.body, '[' || m.type || ']') AS summary,
                 jsonb_build_object('direction', m.direction, 'status', m.status, 'conversationId', m.conversation_id) AS data
          FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE c.contact_id = ${contactId}
          UNION ALL
          SELECT 'deal', e.id::text, e.created_at,
                 CASE e.type WHEN 'created' THEN 'Negocio creado' WHEN 'stage_changed' THEN 'Cambió de etapa'
                             WHEN 'won' THEN 'Negocio ganado' WHEN 'lost' THEN 'Negocio perdido'
                             WHEN 'reopened' THEN 'Negocio reabierto' ELSE e.type END,
                 e.data || jsonb_build_object('dealId', e.deal_id, 'dealTitle', d.title, 'type', e.type)
          FROM deal_events e JOIN deals d ON d.id = e.deal_id
          WHERE d.contact_id = ${contactId}
        ) t
        WHERE ${cursorAt}::timestamptz IS NULL OR (at, kind || ':' || id) < (${cursorAt}::timestamptz, ${cursorKey}::text)
        ORDER BY at DESC, kind || ':' || id DESC
        LIMIT ${limit + 1}`);
      const items = (rows as unknown as TimelineItem[]).slice(0, limit);
      const last = items.at(-1);
      return { items, nextCursor: rows.length > limit && last ? encode(new Date(last.at), `${last.kind}:${last.id}`) : null };
    });
  }

  /** E04-S09 — Consentimiento registrado a mano (formulario, presencial…) con su origen. */
  consent(auth: AuthContext, contactId: string, { optIn, source }: z.infer<typeof consentSchema>) {
    return this.tenant.run(auth, async (tx) => {
      await this.contactsService.findVisible(tx, auth, contactId);
      const changes = optIn
        ? { whatsappOptInAt: new Date(), whatsappOptInSource: source, whatsappOptOutAt: null }
        : { whatsappOptOutAt: new Date() };
      await tx.update(contacts).set(changes).where(eq(contacts.id, contactId));
      return this.contactsService.findVisible(tx, auth, contactId);
    });
  }
}

const encode = (at: Date, key: string) => Buffer.from(`${at.toISOString()}|${key}`).toString('base64url');
function decode(cursor: string): [string, string] {
  const [at, key] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!at || !key || Number.isNaN(Date.parse(at))) throw badRequest('Cursor inválido');
  return [at, key];
}
