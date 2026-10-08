import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { z } from 'zod';
import type { Database, Transaction } from '../../shared/database/database.js';
import { withTenant } from '../../shared/database/with-tenant.js';
import { badRequest } from '../../shared/http/errors.js';
import { PG_POOL, DB } from '../../shared/tokens.js';
import { can } from '../identity/domain/permissions.js';
import type { AuthContext } from '../identity/infrastructure/http/session.guard.js';
import { NotificationsService } from '../tasks/notifications.service.js';
import { TenantContext } from '../tenancy/application/tenant-context.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD');
export const rangeSchema = z.object({ from: day.optional(), to: day.optional(), pipelineId: z.uuid().optional() });
type Range = z.infer<typeof rangeSchema>;

const n = (v: unknown) => Number(v ?? 0);
const rate = (won: number, lost: number) => (won + lost ? won / (won + lost) : null);

/**
 * E08-S01/S02/S03 — Reportes. Las fechas son días en la zona horaria de la empresa (no del servidor).
 * Sin permiso de equipo (`reports:read-team`), el vendedor ve solo sus propios números.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly tenant: TenantContext,
    private readonly notifications: NotificationsService,
    @Inject(DB) private readonly db: Database,
    @Inject(PG_POOL) private readonly conn: { pool: pg.Pool },
  ) {}

  overview(auth: AuthContext, range: Range) {
    return this.tenant.run(auth, async (tx) => {
      const { start, end } = await this.bounds(tx, range);
      const mine = this.onlyMine(auth);
      const pipeline = range.pipelineId ?? null;
      const { rows: [totals] } = await tx.execute<Record<string, string>>(sql`
        SELECT
          (SELECT count(*) FROM contacts WHERE created_at >= ${start} AND created_at < ${end} AND (${mine}::text IS NULL OR owner_id = ${mine})) AS new_leads,
          (SELECT coalesce(sum(value), 0) FROM deals WHERE status = 'open' AND (${pipeline}::uuid IS NULL OR pipeline_id = ${pipeline}) AND (${mine}::text IS NULL OR owner_id = ${mine})) AS pipeline_value,
          (SELECT count(*) FROM deals WHERE status = 'won' AND closed_at >= ${start} AND closed_at < ${end} AND (${pipeline}::uuid IS NULL OR pipeline_id = ${pipeline}) AND (${mine}::text IS NULL OR owner_id = ${mine})) AS won,
          (SELECT coalesce(sum(value), 0) FROM deals WHERE status = 'won' AND closed_at >= ${start} AND closed_at < ${end} AND (${pipeline}::uuid IS NULL OR pipeline_id = ${pipeline}) AND (${mine}::text IS NULL OR owner_id = ${mine})) AS won_value,
          (SELECT count(*) FROM deals WHERE status = 'lost' AND closed_at >= ${start} AND closed_at < ${end} AND (${pipeline}::uuid IS NULL OR pipeline_id = ${pipeline}) AND (${mine}::text IS NULL OR owner_id = ${mine})) AS lost,
          (SELECT coalesce(sum(value), 0) FROM deals WHERE status = 'lost' AND closed_at >= ${start} AND closed_at < ${end} AND (${pipeline}::uuid IS NULL OR pipeline_id = ${pipeline}) AND (${mine}::text IS NULL OR owner_id = ${mine})) AS lost_value`);
      const { rows: byStage } = await tx.execute<{ stage_id: string; name: string; color: string; count: string; value: string }>(sql`
        SELECT s.id AS stage_id, s.name, s.color, count(d.id) AS count, coalesce(sum(d.value), 0) AS value
        FROM stages s
        LEFT JOIN deals d ON d.stage_id = s.id AND d.status = 'open' AND (${mine}::text IS NULL OR d.owner_id = ${mine})
        WHERE s.pipeline_id = coalesce(${pipeline}::uuid, (SELECT id FROM pipelines ORDER BY position, created_at LIMIT 1))
        GROUP BY s.id ORDER BY s.position`);
      const won = n(totals!.won);
      const lost = n(totals!.lost);
      return {
        from: start, to: end,
        newLeads: n(totals!.new_leads),
        pipelineValue: n(totals!.pipeline_value),
        won: { count: won, value: n(totals!.won_value) },
        lost: { count: lost, value: n(totals!.lost_value) },
        conversionRate: rate(won, lost),
        dealsByStage: byStage.map((s) => ({ stageId: s.stage_id, name: s.name, color: s.color, count: n(s.count), value: n(s.value) })),
      };
    });
  }

  performance(auth: AuthContext, range: Range) {
    return this.tenant.run(auth, async (tx) => {
      const { start, end } = await this.bounds(tx, range);
      const mine = this.onlyMine(auth);
      const { rows: byOwner } = await tx.execute<{ owner_id: string | null; name: string | null; deals: string; won: string; lost: string; won_value: string }>(sql`
        SELECT d.owner_id, (SELECT name FROM "user" WHERE id = d.owner_id) AS name,
               count(*) FILTER (WHERE d.created_at >= ${start} AND d.created_at < ${end}) AS deals,
               count(*) FILTER (WHERE d.status = 'won' AND d.closed_at >= ${start} AND d.closed_at < ${end}) AS won,
               count(*) FILTER (WHERE d.status = 'lost' AND d.closed_at >= ${start} AND d.closed_at < ${end}) AS lost,
               coalesce(sum(d.value) FILTER (WHERE d.status = 'won' AND d.closed_at >= ${start} AND d.closed_at < ${end}), 0) AS won_value
        FROM deals d
        WHERE (${mine}::text IS NULL OR d.owner_id = ${mine})
          AND ((d.created_at >= ${start} AND d.created_at < ${end}) OR (d.closed_at >= ${start} AND d.closed_at < ${end}))
        GROUP BY d.owner_id ORDER BY won_value DESC`);
      const { rows: bySource } = await tx.execute<{ source: string; leads: string; deals: string; won: string; lost: string; won_value: string }>(sql`
        WITH leads AS (
          SELECT coalesce(source, 'sin_origen') AS source, count(*) AS leads FROM contacts
          WHERE created_at >= ${start} AND created_at < ${end} AND (${mine}::text IS NULL OR owner_id = ${mine}) GROUP BY 1
        ), sales AS (
          SELECT coalesce(source, 'sin_origen') AS source,
                 count(*) FILTER (WHERE created_at >= ${start} AND created_at < ${end}) AS deals,
                 count(*) FILTER (WHERE status = 'won' AND closed_at >= ${start} AND closed_at < ${end}) AS won,
                 count(*) FILTER (WHERE status = 'lost' AND closed_at >= ${start} AND closed_at < ${end}) AS lost,
                 coalesce(sum(value) FILTER (WHERE status = 'won' AND closed_at >= ${start} AND closed_at < ${end}), 0) AS won_value
          FROM deals WHERE (${mine}::text IS NULL OR owner_id = ${mine}) GROUP BY 1
        )
        SELECT coalesce(l.source, s.source) AS source, coalesce(l.leads, 0) AS leads, coalesce(s.deals, 0) AS deals,
               coalesce(s.won, 0) AS won, coalesce(s.lost, 0) AS lost, coalesce(s.won_value, 0) AS won_value
        FROM leads l FULL JOIN sales s ON s.source = l.source
        WHERE coalesce(l.leads, 0) + coalesce(s.deals, 0) + coalesce(s.won, 0) + coalesce(s.lost, 0) > 0
        ORDER BY won_value DESC, leads DESC`);
      return {
        from: start, to: end,
        byOwner: byOwner.map((r) => ({
          ownerId: r.owner_id, name: r.name ?? 'Sin responsable', deals: n(r.deals), won: n(r.won), lost: n(r.lost), wonValue: n(r.won_value), conversionRate: rate(n(r.won), n(r.lost)),
        })),
        bySource: bySource.map((r) => ({
          source: r.source, leads: n(r.leads), deals: n(r.deals), won: n(r.won), lost: n(r.lost), wonValue: n(r.won_value), conversionRate: rate(n(r.won), n(r.lost)),
        })),
      };
    });
  }

  /**
   * E08-S02 — Primera respuesta: desde el primer mensaje del cliente hasta la primera respuesta de una PERSONA
   * (las automáticas — fuera de horario, plantillas de reglas — no tienen sent_by y no cuentan).
   */
  responseTimes(auth: AuthContext, range: Range) {
    return this.tenant.run(auth, async (tx) => {
      const { start, end } = await this.bounds(tx, range);
      const mine = this.onlyMine(auth);
      const [{ sla }] = (await tx.execute(sql`SELECT first_response_sla_minutes AS sla FROM tenant_settings`)).rows as [{ sla: number }];
      const { rows } = await tx.execute<{ responder: string | null; name: string | null; conversations: string; avg_minutes: string | null; breaches: string }>(sql`
        WITH firsts AS (
          SELECT c.id, (SELECT min(created_at) FROM messages WHERE conversation_id = c.id AND direction = 'in') AS first_in
          FROM conversations c
        ), answered AS (
          SELECT f.id, f.first_in, r.sent_by, r.created_at AS first_out
          FROM firsts f
          LEFT JOIN LATERAL (
            SELECT sent_by, created_at FROM messages
            WHERE conversation_id = f.id AND direction = 'out' AND sent_by IS NOT NULL AND created_at >= f.first_in
            ORDER BY created_at LIMIT 1
          ) r ON true
          WHERE f.first_in >= ${start} AND f.first_in < ${end}
        )
        SELECT sent_by AS responder, (SELECT name FROM "user" WHERE id = sent_by) AS name, count(*) AS conversations,
               avg(extract(epoch FROM first_out - first_in) / 60) AS avg_minutes,
               count(*) FILTER (WHERE first_out IS NULL AND now() - first_in > make_interval(mins => ${sla})
                                OR first_out - first_in > make_interval(mins => ${sla})) AS breaches
        FROM answered
        WHERE ${mine}::text IS NULL OR sent_by = ${mine}
        GROUP BY sent_by`);
      const answered = rows.filter((r) => r.responder);
      const pending = rows.find((r) => !r.responder);
      const total = answered.reduce((acc, r) => acc + n(r.conversations), 0);
      return {
        from: start, to: end, slaMinutes: sla,
        byResponder: answered.map((r) => ({ userId: r.responder!, name: r.name, conversations: n(r.conversations), avgMinutes: n(r.avg_minutes), breaches: n(r.breaches) })),
        overall: {
          conversations: total,
          avgMinutes: total ? answered.reduce((acc, r) => acc + n(r.avg_minutes) * n(r.conversations), 0) / total : null,
          breaches: answered.reduce((acc, r) => acc + n(r.breaches), 0),
          pending: n(pending?.conversations), pendingBreaches: n(pending?.breaches),
        },
      };
    });
  }

  /** E08-S02 — Alerta una vez por conversación cuando la primera respuesta supera el SLA. */
  async alertSlaBreaches(now = new Date()) {
    const { rows } = await this.conn.pool.query<{ tenant_id: string; conversation_id: string }>('SELECT tenant_id, conversation_id FROM sla_breach_candidates($1)', [now]);
    for (const { tenant_id: tenantId, conversation_id: id } of rows) {
      const created = await withTenant(this.db, tenantId, async (tx) => {
        const { rows: marked } = await tx.execute<{ assigned_to: string | null; name: string; phone: string | null; sla: number }>(sql`
          UPDATE conversations c SET first_response_alerted_at = ${now}
          FROM contacts ct, tenant_settings s
          WHERE c.id = ${id} AND c.first_response_alerted_at IS NULL AND ct.id = c.contact_id
          RETURNING c.assigned_to, ct.name, ct.phone, s.first_response_sla_minutes AS sla`);
        const conv = marked[0];
        if (!conv) return [];
        const recipients = conv.assigned_to
          ? [conv.assigned_to]
          : (await tx.execute<{ id: string }>(sql`SELECT "userId" AS id FROM member WHERE "organizationId" = ${tenantId} AND role IN ('owner', 'admin')`)).rows.map((r) => r.id);
        const who = conv.phone && conv.phone !== conv.name ? `${conv.name} · ${conv.phone}` : conv.name;
        return this.notifications.create(tx, tenantId, recipients, {
          type: 'sla_breach', title: `Sin primera respuesta: ${who}`, body: `Lleva más de ${conv.sla} minutos esperando.`, link: `/inbox?c=${id}`,
        });
      }).catch((error: Error) => {
        this.logger.error(`Alerta SLA ${id}: ${error.message}`);
        return [];
      });
      await this.notifications.deliver(tenantId, created, true);
    }
  }

  /** E08-S04 — Embudo de activación de la plataforma, por cohorte de registro. Solo agregados. */
  async activationFunnel(range: Range) {
    const start = range.from ? new Date(`${range.from}T00:00:00Z`) : new Date(0);
    const end = range.to ? new Date(Date.parse(`${range.to}T00:00:00Z`) + 86_400_000) : new Date(Date.now() + 86_400_000);
    if (start >= end) throw badRequest('La fecha inicial debe ser anterior a la final');
    const { rows: [r] } = await this.conn.pool.query('SELECT * FROM activation_funnel($1, $2)', [start, end]);
    const counts = { registered: n(r.registered), whatsappConnected: n(r.whatsapp_connected), firstLead: n(r.first_lead), firstDealWon: n(r.first_deal_won) };
    return {
      from: start, to: end, ...counts,
      steps: [
        { key: 'registered', count: counts.registered },
        { key: 'whatsapp_connected', count: counts.whatsappConnected },
        { key: 'first_lead', count: counts.firstLead },
        { key: 'first_deal_won', count: counts.firstDealWon },
      ].map((s) => ({ ...s, rateFromRegistered: counts.registered ? s.count / counts.registered : null })),
      medianHoursToWhatsapp: r.median_hours_whatsapp,
      medianHoursToFirstLead: r.median_hours_first_lead,
      medianHoursToFirstWon: r.median_hours_first_won,
    };
  }

  /** Inicio y fin (exclusivo) del rango en la zona de la empresa; por defecto, los últimos 30 días. */
  private async bounds(tx: Transaction, range: Range) {
    const [{ tz }] = (await tx.execute(sql`SELECT timezone AS tz FROM tenant_settings`)).rows as [{ tz: string }];
    const { rows: [b] } = await tx.execute<{ start: Date; end: Date }>(sql`
      SELECT (coalesce(${range.from ?? null}::date, (now() AT TIME ZONE ${tz})::date - 29)::timestamp AT TIME ZONE ${tz}) AS start,
             ((coalesce(${range.to ?? null}::date, (now() AT TIME ZONE ${tz})::date) + 1)::timestamp AT TIME ZONE ${tz}) AS end`);
    if (b!.start >= b!.end) throw badRequest('La fecha inicial debe ser anterior a la final');
    return b!;
  }

  private onlyMine(auth: AuthContext): string | null {
    return can(auth.role, 'reports:read-team') ? null : auth.userId;
  }
}
