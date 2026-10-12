import { Controller, Get, HttpCode, HttpStatus, Inject, Injectable, Logger, NotFoundException, Param, Post, Put, UseGuards } from '@nestjs/common';
import { NoAudit } from '../../shared/http/audit.js';
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type pg from 'pg';
import { z } from 'zod';
import type { Database, Transaction } from '../../shared/database/database.js';
import { notificationPreferences, notifications, pushSubscriptions } from '../../shared/database/schema.js';
import { AppError } from '../../shared/http/app-error.js';
import { ZodBody } from '../../shared/http/zod-validation.pipe.js';
import { effectivePreference, isImportant, NOTIFICATION_TYPE_IDS, NOTIFICATION_TYPES, type Preference } from './domain/notification-types.js';
import { withTenant } from '../../shared/database/with-tenant.js';
import type { Env } from '../../config/env.js';
import type { Mailer } from '../../shared/mail/mailer.js';
import type { PushSender } from '../../shared/push/push-sender.js';
import { RealtimeGateway } from '../../shared/realtime/realtime.gateway.js';
import { DB, ENV, MAILER, PG_POOL, PUSH_SENDER } from '../../shared/tokens.js';
import { AllowWhenReadOnly, type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';

export interface NotificationInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
  email?: boolean;
}

export const preferenceSchema = z.object({ type: z.enum(NOTIFICATION_TYPE_IDS), inApp: z.boolean(), email: z.boolean(), push: z.boolean() }).strict();
export const pushSubscriptionSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
}).strip();
export const pushUnsubscribeSchema = z.object({ endpoint: z.string().max(2048) }).strict();

const escape = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** E06-S02 / E14-S04 — Notificaciones in-app (campana) y, según preferencias, por correo y push. */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PG_POOL) private readonly conn: { pool: pg.Pool },
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
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
    const userIds = created.map((n) => n.userId);
    // En serie: una transacción es una sola conexión y pg no admite consultas en paralelo sobre ella.
    const [prefs, devices] = await withTenant(this.db, tenantId, async (tx) => [
      await tx.select().from(notificationPreferences).where(inArray(notificationPreferences.userId, userIds)),
      await tx.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds)),
    ] as const);
    for (const n of created) {
      if (n.inApp) this.realtime.publish(tenantId, 'notification.created', { userId: n.userId, notificationId: n.id }, n.userId);
      const user = rows.find((r) => r.id === n.userId);
      const pref = effectivePreference(n.type, prefs.find((p) => p.userId === n.userId && p.type === n.type));
      if (pref.push) await this.sendPush(tenantId, devices.filter((d) => d.userId === n.userId), n);
      if (!email || !user || !pref.email) continue;
      const url = n.link ? `${this.env.APP_URL}${n.link}` : this.env.APP_URL;
      await this.mailer.send({
        to: user.email,
        subject: n.title,
        text: `${n.title}${n.body ? `\n\n${n.body}` : ''}\n\nVer en BeeCRM: ${url}`,
        html: `<p><strong>${escape(n.title)}</strong></p>${n.body ? `<p>${escape(n.body)}</p>` : ''}<p><a href="${escape(url)}">Ver en BeeCRM</a></p>`,
      });
    }
  }

  /** Un dispositivo caído no frena a los demás ni al correo; los vencidos se borran. */
  private async sendPush(tenantId: string, devices: (typeof pushSubscriptions.$inferSelect)[], n: typeof notifications.$inferSelect) {
    if (!devices.length) return;
    const payload = { title: n.title, body: n.body, link: n.link, tag: n.id };
    const results = await Promise.allSettled(devices.map((d) => this.push.send(d, payload)));
    const gone = devices.filter((_, i) => {
      const r = results[i]!;
      if (r.status === 'rejected') this.logger.warn(`Push falló: ${String(r.reason)}`);
      return r.status === 'fulfilled' && r.value === 'gone';
    });
    if (gone.length) await withTenant(this.db, tenantId, (tx) => tx.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone.map((d) => d.id))));
  }

  pushConfig() {
    return { publicKey: this.env.VAPID_PUBLIC_KEY ?? null };
  }

  subscribe(auth: AuthContext, input: z.infer<typeof pushSubscriptionSchema>) {
    if (!this.env.VAPID_PUBLIC_KEY) throw new AppError(HttpStatus.CONFLICT, 'PUSH_DISABLED', 'Las notificaciones push no están configuradas en este servidor');
    // El mismo navegador puede pasar a otra persona (cierre de sesión): el endpoint queda con la última.
    return withTenant(this.db, auth.tenantId, async (tx) => void (await tx.insert(pushSubscriptions)
      .values({ tenantId: auth.tenantId, userId: auth.userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth })
      .onConflictDoUpdate({ target: [pushSubscriptions.tenantId, pushSubscriptions.endpoint], set: { userId: auth.userId, p256dh: input.keys.p256dh, auth: input.keys.auth } })));
  }

  unsubscribe(auth: AuthContext, endpoint: string) {
    return withTenant(this.db, auth.tenantId, async (tx) => void (await tx.delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, auth.userId), eq(pushSubscriptions.endpoint, endpoint)))));
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
      return { items: items.map(({ tenantId: _t, ...n }) => ({ ...n, important: isImportant(n.type) })), unread: Number(counter?.unread ?? 0) };
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
      .values({ tenantId: auth.tenantId, userId: auth.userId, type: input.type, inApp: input.inApp, email: input.email, push: input.push })
      .onConflictDoUpdate({ target: [notificationPreferences.tenantId, notificationPreferences.userId, notificationPreferences.type], set: { inApp: input.inApp, email: input.email, push: input.push } }));
    return this.preferences(auth);
  }

  private async preferencesOf(tx: Transaction, userIds: string[], type: string) {
    const rows = await tx.select().from(notificationPreferences)
      .where(and(inArray(notificationPreferences.userId, userIds), eq(notificationPreferences.type, type)));
    return new Map<string, Preference>(rows.map((r) => [r.userId, { inApp: r.inApp, email: r.email, push: r.push }]));
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

  @Get('push/config') @RequirePermission('settings:read')
  pushConfig() { return this.notificationsService.pushConfig(); }

  @Post('push/subscriptions') @HttpCode(HttpStatus.NO_CONTENT) @AllowWhenReadOnly() @NoAudit() @RequirePermission('settings:read')
  subscribe(@CurrentAuth() auth: AuthContext, @ZodBody(pushSubscriptionSchema) body: z.infer<typeof pushSubscriptionSchema>) { return this.notificationsService.subscribe(auth, body); }

  @Post('push/unsubscribe') @HttpCode(HttpStatus.NO_CONTENT) @AllowWhenReadOnly() @NoAudit() @RequirePermission('settings:read')
  unsubscribe(@CurrentAuth() auth: AuthContext, @ZodBody(pushUnsubscribeSchema) body: z.infer<typeof pushUnsubscribeSchema>) { return this.notificationsService.unsubscribe(auth, body.endpoint); }

  @Post('read-all') @HttpCode(HttpStatus.NO_CONTENT) @AllowWhenReadOnly() @NoAudit() @RequirePermission('settings:read')
  readAll(@CurrentAuth() auth: AuthContext) { return this.notificationsService.markRead(auth, 'all'); }

  @Post(':id/read') @HttpCode(HttpStatus.NO_CONTENT) @AllowWhenReadOnly() @NoAudit() @RequirePermission('settings:read')
  read(@CurrentAuth() auth: AuthContext, @Param('id') id: string) { return this.notificationsService.markRead(auth, id); }
}
