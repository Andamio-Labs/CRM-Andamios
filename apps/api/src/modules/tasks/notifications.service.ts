import { Controller, Get, HttpCode, HttpStatus, Inject, Injectable, NotFoundException, Param, Post, Put, UseGuards } from '@nestjs/common';
import { NoAudit } from '../../shared/http/audit.js';
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type pg from 'pg';
import { z } from 'zod';
import type { Database, Transaction } from '../../shared/database/database.js';
import { notificationPreferences, notifications } from '../../shared/database/schema.js';
import { AppError } from '../../shared/http/app-error.js';
import { ZodBody } from '../../shared/http/zod-validation.pipe.js';
import { effectivePreference, NOTIFICATION_TYPE_IDS, NOTIFICATION_TYPES, type Preference } from './domain/notification-types.js';
import { withTenant } from '../../shared/database/with-tenant.js';
import type { Env } from '../../config/env.js';
import type { Mailer } from '../../shared/mail/mailer.js';
import { RealtimeGateway } from '../../shared/realtime/realtime.gateway.js';
import { DB, ENV, MAILER, PG_POOL } from '../../shared/tokens.js';
import { AllowWhenReadOnly, type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';

export interface NotificationInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
  email?: boolean;
}

export const preferenceSchema = z.object({ type: z.enum(NOTIFICATION_TYPE_IDS), inApp: z.boolean(), email: z.boolean() }).strict();

const escape = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** E06-S02 / E14-S04 — Notificaciones in-app (campana) y, si corresponde, por correo. */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PG_POOL) private readonly conn: { pool: pg.Pool },
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Inserta en la transacción del llamador; correo y aviso en vivo se mandan con `deliver` tras el commit. */
  async create(tx: Transaction, tenantId: string, userIds: string[], input: NotificationInput) {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return [];
    // E14-S04 — Con la campana apagada se guarda igual (in_app = false): no se ve, pero el correo puede salir.
    const prefs = await this.preferencesOf(tx, unique, input.type);
    return tx.insert(notifications)
      .values(unique.map((userId) => ({
        tenantId, userId, type: input.type, title: input.title, body: input.body ?? null, link: input.link ?? null,
        inApp: effectivePreference(input.type, prefs.get(userId)).inApp,
      })))
      .returning();
  }

  async deliver(tenantId: string, created: (typeof notifications.$inferSelect)[], email: boolean) {
    if (!created.length) return;
    const { rows } = await this.conn.pool.query<{ id: string; email: string; name: string }>(`SELECT id, email, name FROM "user" WHERE id = ANY($1)`, [created.map((n) => n.userId)]);
    const prefs = email
      ? await withTenant(this.db, tenantId, (tx) => tx.select().from(notificationPreferences).where(inArray(notificationPreferences.userId, created.map((n) => n.userId))))
      : [];
    for (const n of created) {
      if (n.inApp) this.realtime.publish(tenantId, 'notification.created', { userId: n.userId, notificationId: n.id }, n.userId);
      const user = rows.find((r) => r.id === n.userId);
      const stored = prefs.find((p) => p.userId === n.userId && p.type === n.type);
      if (!email || !user || !effectivePreference(n.type, stored).email) continue;
      const url = n.link ? `${this.env.APP_URL}${n.link}` : this.env.APP_URL;
      await this.mailer.send({
        to: user.email,
        subject: n.title,
        text: `${n.title}${n.body ? `\n\n${n.body}` : ''}\n\nVer en BeeCRM: ${url}`,
        html: `<p><strong>${escape(n.title)}</strong></p>${n.body ? `<p>${escape(n.body)}</p>` : ''}<p><a href="${escape(url)}">Ver en BeeCRM</a></p>`,
      });
    }
  }

  /** Atajo: crea y entrega en su propia transacción. */
  async notify(tenantId: string, userIds: string[], input: NotificationInput) {
    const created = await withTenant(this.db, tenantId, (tx) => this.create(tx, tenantId, userIds, input));
    await this.deliver(tenantId, created, input.email ?? false);
  }

  list(auth: AuthContext) {
    return withTenant(this.db, auth.tenantId, async (tx) => {
      const mine = and(eq(notifications.userId, auth.userId), eq(notifications.inApp, true));
      const items = await tx.select().from(notifications).where(mine).orderBy(desc(notifications.createdAt)).limit(50);
      const [counter] = await tx.select({ unread: count() }).from(notifications).where(and(mine, isNull(notifications.readAt)));
      return { items: items.map(({ tenantId: _t, ...n }) => n), unread: Number(counter?.unread ?? 0) };
    });
  }

  preferences(auth: AuthContext) {
    return withTenant(this.db, auth.tenantId, async (tx) => {
      const stored = await tx.select().from(notificationPreferences).where(eq(notificationPreferences.userId, auth.userId));
      return NOTIFICATION_TYPE_IDS.map((type) => ({
        type, ...NOTIFICATION_TYPES[type], ...effectivePreference(type, stored.find((p) => p.type === type)),
      }));
    });
  }

  async setPreference(auth: AuthContext, input: z.infer<typeof preferenceSchema>) {
    if (!input.email && NOTIFICATION_TYPES[input.type].emailLocked) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'EMAIL_REQUIRED', 'Los avisos de plan y pagos siempre llegan por correo');
    }
    await withTenant(this.db, auth.tenantId, (tx) => tx.insert(notificationPreferences)
      .values({ tenantId: auth.tenantId, userId: auth.userId, type: input.type, inApp: input.inApp, email: input.email })
      .onConflictDoUpdate({ target: [notificationPreferences.tenantId, notificationPreferences.userId, notificationPreferences.type], set: { inApp: input.inApp, email: input.email } }));
    return this.preferences(auth);
  }

  private async preferencesOf(tx: Transaction, userIds: string[], type: string) {
    const rows = await tx.select().from(notificationPreferences)
      .where(and(inArray(notificationPreferences.userId, userIds), eq(notificationPreferences.type, type)));
    return new Map<string, Preference>(rows.map((r) => [r.userId, { inApp: r.inApp, email: r.email }]));
  }

  markRead(auth: AuthContext, id: string | 'all') {
    return withTenant(this.db, auth.tenantId, async (tx) => {
      const mine = and(eq(notifications.userId, auth.userId), isNull(notifications.readAt));
      if (id === 'all') return void (await tx.update(notifications).set({ readAt: sql`now()` }).where(mine));
      if (!z.uuid().safeParse(id).success) throw new NotFoundException();
      const updated = await tx.update(notifications).set({ readAt: sql`now()` }).where(and(mine, eq(notifications.id, id))).returning({ id: notifications.id });
      if (!updated.length) throw new NotFoundException();
    });
  }
}

@Controller('v1/notifications')
@UseGuards(SessionGuard, PermissionGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get() @RequirePermission('settings:read')
  list(@CurrentAuth() auth: AuthContext) { return this.notificationsService.list(auth); }

  @Get('preferences') @RequirePermission('settings:read')
  preferences(@CurrentAuth() auth: AuthContext) { return this.notificationsService.preferences(auth); }

  @Put('preferences') @AllowWhenReadOnly() @NoAudit() @RequirePermission('settings:read')
  setPreference(@CurrentAuth() auth: AuthContext, @ZodBody(preferenceSchema) body: z.infer<typeof preferenceSchema>) { return this.notificationsService.setPreference(auth, body); }

  @Post('read-all') @HttpCode(HttpStatus.NO_CONTENT) @AllowWhenReadOnly() @NoAudit() @RequirePermission('settings:read')
  readAll(@CurrentAuth() auth: AuthContext) { return this.notificationsService.markRead(auth, 'all'); }

  @Post(':id/read') @HttpCode(HttpStatus.NO_CONTENT) @AllowWhenReadOnly() @NoAudit() @RequirePermission('settings:read')
  read(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.notificationsService.markRead(auth, id); }
}
