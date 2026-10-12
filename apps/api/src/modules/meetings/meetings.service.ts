import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gt, isNotNull, lt, lte, or, type SQL, sql } from 'drizzle-orm';
import type pg from 'pg';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { Transaction } from '../../shared/database/database.js';
import { deals, meetings } from '../../shared/database/schema.js';
import { badRequest } from '../../shared/http/errors.js';
import type { Mailer } from '../../shared/mail/mailer.js';
import { ENV, MAILER, PG_POOL } from '../../shared/tokens.js';
import type { AuthContext } from '../identity/infrastructure/http/session.guard.js';
import { NotificationsService } from '../tasks/notifications.service.js';
import { TenantContext } from '../tenancy/application/tenant-context.js';
import { meetingCanceledEmail, meetingInvitationEmail } from './meeting-email.js';

/** Solo https: el enlace se abre con un clic, nunca un `javascript:` ni un sitio sin cifrar. */
const httpsUrl = z.url({ protocol: /^https$/ }).max(500);

export const createMeetingSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    agenda: z.string().trim().max(5000).nullish(),
    /** Sin fecha: reunión inmediata ("Nueva reunión"). */
    startsAt: z.iso.datetime({ offset: true }).optional(),
    durationMinutes: z.number().int().min(5).max(480).default(60),
    participantIds: z.array(z.string().max(64)).max(50).default([]),
    guestEmails: z.array(z.email().trim().toLowerCase()).max(20).default([]),
    dealId: z.uuid().nullish(),
    /** Enlace propio (Google Meet, Zoom, Teams…). Sin él se abre una sala nueva. */
    joinUrl: httpsUrl.nullish(),
  })
  .strict();

/** Después de la reunión: el acta y el enlace de la grabación. */
export const updateMeetingSchema = z
  .object({ minutes: z.string().trim().max(20_000).nullable(), recordingUrl: httpsUrl.nullable() })
  .partial()
  .strict();

export const listMeetingsSchema = z
  .object({
    scope: z.enum(['upcoming', 'past', 'recordings', 'minutes', 'range']).default('upcoming'),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((q) => q.scope !== 'range' || (q.from && q.to), 'El calendario necesita las fechas desde y hasta');

type MeetingRow = typeof meetings.$inferSelect;

function scopeFilter(q: z.infer<typeof listMeetingsSchema>): SQL | undefined {
  switch (q.scope) {
    case 'upcoming': return gt(meetings.endsAt, sql`now()`);
    case 'past': return lte(meetings.endsAt, sql`now()`);
    case 'recordings': return isNotNull(meetings.recordingUrl);
    case 'minutes': return isNotNull(meetings.minutes);
    case 'range': return and(lt(meetings.startsAt, new Date(q.to!)), gt(meetings.endsAt, new Date(q.from!)));
  }
}

const when = (at: Date, settings: { locale: string; timezone: string }) =>
  at.toLocaleString(settings.locale, { timeZone: settings.timezone, dateStyle: 'full', timeStyle: 'short' });

/** Quien organiza cancela; propietario y admins también pueden. */
const canManage = (auth: AuthContext, meeting: Pick<MeetingRow, 'organizerId'>) => meeting.organizerId === auth.userId || auth.role !== 'member';

/**
 * E12-S03 — Reuniones online con colegas e invitados externos, atadas a un negocio si se quiere.
 * Cada persona ve las que organiza o a las que la invitaron.
 */
@Injectable()
export class MeetingsService {
  constructor(
    private readonly tenant: TenantContext,
    private readonly notifications: NotificationsService,
    @Inject(PG_POOL) private readonly conn: { pool: pg.Pool },
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(auth: AuthContext, query: z.infer<typeof listMeetingsSchema>) {
    const recentFirst = query.scope !== 'upcoming' && query.scope !== 'range';
    const rows = await this.tenant.run(auth, (tx) => this.scoped(tx)
      .where(and(this.mine(auth), scopeFilter(query)))
      .orderBy(recentFirst ? desc(meetings.startsAt) : asc(meetings.startsAt))
      .limit(200));
    return this.views(auth, rows);
  }

  async create(auth: AuthContext, input: z.infer<typeof createMeetingSchema>) {
    const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
    const participantIds = [...new Set(input.participantIds)].filter((id) => id !== auth.userId);
    const { row, created, settings } = await this.tenant.run(auth, async (tx) => {
      await this.assertTeam(tx, auth, participantIds);
      if (input.dealId) await this.assertDeal(tx, auth, input.dealId);
      const [row] = await tx.insert(meetings).values({
        tenantId: auth.tenantId,
        title: input.title,
        agenda: input.agenda || null,
        startsAt,
        endsAt: new Date(startsAt.getTime() + input.durationMinutes * 60_000),
        joinUrl: input.joinUrl ?? this.newRoom(),
        organizerId: auth.userId,
        participantIds,
        guestEmails: [...new Set(input.guestEmails)],
        dealId: input.dealId ?? null,
      }).returning();
      const settings = await this.tenant.settings(tx);
      const created = await this.notifications.create(tx, auth.tenantId, participantIds, {
        type: 'meeting_invite',
        title: `Te invitaron a: ${row!.title}`,
        body: input.startsAt ? `${when(row!.startsAt, settings)}.` : 'Empieza ahora. Entra desde Reuniones.',
        link: `/meetings?m=${row!.id}`,
      });
      return { row: row!, created, settings };
    });
    await this.notifications.deliver(auth.tenantId, created, true);
    if (row.guestEmails.length) {
      const names = await this.senderNames(auth);
      for (const to of row.guestEmails) {
        await this.mailer.send(meetingInvitationEmail({
          to, title: row.title, organizer: names.organizer, organization: names.organization,
          when: when(row.startsAt, settings), joinUrl: row.joinUrl, agenda: row.agenda,
        }));
      }
    }
    return this.get(auth, row.id);
  }

  async update(auth: AuthContext, id: string, input: z.infer<typeof updateMeetingSchema>) {
    await this.tenant.run(auth, async (tx) => {
      await this.findMine(tx, auth, id);
      const changes: Partial<typeof meetings.$inferInsert> = {};
      if (input.minutes !== undefined) changes.minutes = input.minutes || null;
      if (input.recordingUrl !== undefined) changes.recordingUrl = input.recordingUrl;
      if (Object.keys(changes).length) await tx.update(meetings).set(changes).where(eq(meetings.id, id));
    });
    return this.get(auth, id);
  }

  async remove(auth: AuthContext, id: string) {
    const { row, created, settings, upcoming } = await this.tenant.run(auth, async (tx) => {
      const row = await this.findMine(tx, auth, id);
      if (!canManage(auth, row)) throw new ForbiddenException('Solo quien organiza la reunión puede cancelarla.');
      await tx.delete(meetings).where(eq(meetings.id, id));
      const settings = await this.tenant.settings(tx);
      // Solo se avisa si todavía no terminó: borrar una reunión pasada es limpiar el historial.
      const upcoming = row.endsAt > new Date();
      const recipients = upcoming ? [row.organizerId, ...row.participantIds].filter((u): u is string => Boolean(u) && u !== auth.userId) : [];
      const created = await this.notifications.create(tx, auth.tenantId, recipients, {
        type: 'meeting_invite', title: `Se canceló: ${row.title}`, body: `Era el ${when(row.startsAt, settings)}.`, link: '/meetings',
      });
      return { row, created, settings, upcoming };
    });
    await this.notifications.deliver(auth.tenantId, created, true);
    if (upcoming && row.guestEmails.length) {
      const { organizer } = await this.senderNames(auth);
      for (const to of row.guestEmails) {
        await this.mailer.send(meetingCanceledEmail({ to, title: row.title, organizer, when: when(row.startsAt, settings) }));
      }
    }
  }

  private scoped(tx: Transaction) {
    return tx.select({ meeting: meetings, dealTitle: deals.title })
      .from(meetings).leftJoin(deals, eq(deals.id, meetings.dealId)).$dynamic();
  }

  private mine(auth: AuthContext) {
    return or(eq(meetings.organizerId, auth.userId), sql`${auth.userId} = ANY(${meetings.participantIds})`);
  }

  private async findMine(tx: Transaction, auth: AuthContext, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    const [row] = await tx.select().from(meetings).where(and(eq(meetings.id, id), this.mine(auth)));
    if (!row) throw new NotFoundException();
    return row;
  }

  async get(auth: AuthContext, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    const rows = await this.tenant.run(auth, (tx) => this.scoped(tx).where(and(eq(meetings.id, id), this.mine(auth))));
    if (!rows.length) throw new NotFoundException();
    return (await this.views(auth, rows))[0]!;
  }

  /** Nombres de organizador y participantes (también de quien ya no está en el equipo). */
  private async views(auth: AuthContext, rows: { meeting: MeetingRow; dealTitle: string | null }[]) {
    const ids = [...new Set(rows.flatMap(({ meeting }) => [meeting.organizerId, ...meeting.participantIds]))]
      .filter((id): id is string => Boolean(id));
    const people = ids.length
      ? (await this.conn.pool.query<{ id: string; name: string }>(`SELECT id, name FROM "user" WHERE id = ANY($1)`, [ids])).rows
      : [];
    const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
    return rows.map(({ meeting: { tenantId: _t, ...meeting }, dealTitle }) => ({
      ...meeting,
      dealTitle,
      organizerName: nameOf(meeting.organizerId),
      participants: meeting.participantIds.map((userId) => ({ userId, name: nameOf(userId) })),
      canManage: canManage(auth, meeting),
    }));
  }

  private async assertTeam(tx: Transaction, auth: AuthContext, userIds: string[]) {
    if (!userIds.length) return;
    const { rows } = await tx.execute(sql`SELECT "userId" FROM member WHERE "organizationId" = ${auth.tenantId}`);
    const team = new Set((rows as { userId: string }[]).map((r) => r.userId));
    if (userIds.some((id) => !team.has(id))) throw badRequest('Invita solo a personas de tu equipo; a las de afuera, por correo.');
  }

  private async assertDeal(tx: Transaction, auth: AuthContext, dealId: string) {
    const [deal] = await tx.select({ id: deals.id }).from(deals)
      .where(and(eq(deals.id, dealId), await this.tenant.visibilityFilter(tx, auth, deals.ownerId)));
    if (!deal) throw new NotFoundException('El negocio no existe');
  }

  private async senderNames(auth: AuthContext) {
    const { rows } = await this.conn.pool.query<{ organization: string; organizer: string }>(
      `SELECT o.name AS organization, u.name AS organizer FROM organization o, "user" u WHERE o.id = $1 AND u.id = $2`,
      [auth.tenantId, auth.userId],
    );
    return rows[0]!;
  }

  /** Sala Jitsi con nombre aleatorio de 96 bits: imposible de adivinar. */
  private newRoom() {
    return `${this.env.MEETINGS_URL.replace(/\/+$/, '')}/BeeCRM-${randomBytes(12).toString('hex')}`;
  }
}
