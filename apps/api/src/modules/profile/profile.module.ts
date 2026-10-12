import { Controller, Delete, Get, HttpCode, HttpStatus, Inject, Injectable, Module, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import { z } from 'zod';
import type { Database } from '../../shared/database/database.js';
import { userProfiles } from '../../shared/database/schema.js';
import { withTenant } from '../../shared/database/with-tenant.js';
import { AppError } from '../../shared/http/app-error.js';
import { NoAudit } from '../../shared/http/audit.js';
import { ZodBody } from '../../shared/http/zod-validation.pipe.js';
import type { ObjectStorage } from '../../shared/storage/object-storage.js';
import { DB, PG_POOL, STORAGE } from '../../shared/tokens.js';
import { IdentityModule } from '../identity/identity.module.js';
import { AllowWhenReadOnly, type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';

/** Vacío = borrar el dato. */
const optionalText = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable().optional();
export const updateProfileSchema = z.object({
  position: optionalText(80),
  phone: optionalText(40),
  address: optionalText(200),
  bio: optionalText(1000),
}).strict();

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_TTL_SECONDS = 24 * 3600;

/** Se mira la firma del archivo, no la extensión ni el content-type que manda el navegador. */
function imageType(buffer: Buffer): { type: string; ext: string } | null {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', ext: 'png' };
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}

/** Perfil personal (es de la persona, se ve igual en todas sus empresas) y "Mi actividad" en la empresa activa. */
@Injectable()
export class ProfileService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PG_POOL) private readonly conn: { pool: pg.Pool },
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async get(auth: AuthContext) {
    const { rows: [me] } = await this.conn.pool.query<{ id: string; name: string; email: string; emailVerified: boolean; memberSince: Date; companyName: string }>(
      `SELECT u.id, u.name, u.email, u."emailVerified", m."createdAt" AS "memberSince", o.name AS "companyName"
       FROM "user" u JOIN member m ON m."userId" = u.id AND m."organizationId" = $2 JOIN organization o ON o.id = m."organizationId"
       WHERE u.id = $1`,
      [auth.userId, auth.tenantId],
    );
    const [profile] = await this.db.select().from(userProfiles).where(eq(userProfiles.userId, auth.userId));
    return {
      ...me!,
      role: auth.role,
      position: profile?.position ?? null,
      phone: profile?.phone ?? null,
      address: profile?.address ?? null,
      bio: profile?.bio ?? null,
      avatarUrl: profile?.avatarKey ? this.storage.signedUrl(profile.avatarKey, AVATAR_TTL_SECONDS) : null,
    };
  }

  async update(auth: AuthContext, input: z.infer<typeof updateProfileSchema>) {
    await this.db.insert(userProfiles).values({ userId: auth.userId, ...input })
      .onConflictDoUpdate({ target: userProfiles.userId, set: { ...input, updatedAt: sql`now()` } });
    return this.get(auth);
  }

  async setAvatar(auth: AuthContext, file?: { buffer: Buffer; size: number }) {
    const image = file ? imageType(file.buffer) : null;
    if (!file || !image) throw new AppError(HttpStatus.BAD_REQUEST, 'INVALID_IMAGE', 'Sube una imagen PNG, JPG o WebP de hasta 2 MB.');
    const key = `avatars/${auth.userId}/${randomUUID()}.${image.ext}`;
    await this.storage.put(key, file.buffer, image.type);
    const previous = await this.replaceAvatarKey(auth.userId, key);
    if (previous) await this.storage.delete(previous);
    return { avatarUrl: this.storage.signedUrl(key, AVATAR_TTL_SECONDS) };
  }

  async removeAvatar(auth: AuthContext) {
    const previous = await this.replaceAvatarKey(auth.userId, null);
    if (previous) await this.storage.delete(previous);
  }

  private async replaceAvatarKey(userId: string, key: string | null) {
    const [before] = await this.db.select({ key: userProfiles.avatarKey }).from(userProfiles).where(eq(userProfiles.userId, userId));
    await this.db.insert(userProfiles).values({ userId, avatarKey: key })
      .onConflictDoUpdate({ target: userProfiles.userId, set: { avatarKey: key, updatedAt: sql`now()` } });
    return before?.key ?? null;
  }

  /** Contadores de la persona en la empresa activa; "hoy" y "este mes" en la zona horaria de la empresa. */
  activity(auth: AuthContext) {
    return withTenant(this.db, auth.tenantId, async (tx) => {
      const me = auth.userId;
      const { rows: [c] } = await tx.execute<Record<string, string>>(sql`
        WITH tz AS (SELECT timezone AS name FROM tenant_settings),
             bounds AS (
               SELECT (date_trunc('day', now() AT TIME ZONE tz.name) AT TIME ZONE tz.name) AS day_start,
                      ((date_trunc('day', now() AT TIME ZONE tz.name) + interval '1 day') AT TIME ZONE tz.name) AS day_end,
                      (date_trunc('month', now() AT TIME ZONE tz.name) AT TIME ZONE tz.name) AS month_start
               FROM tz)
        SELECT
          (SELECT count(*) FROM deals WHERE owner_id = ${me} AND status = 'open') AS deals_open,
          (SELECT count(*) FROM deals, bounds WHERE owner_id = ${me} AND status = 'won' AND closed_at >= bounds.month_start) AS deals_won_month,
          (SELECT count(*) FROM tasks WHERE assignee_id = ${me} AND status = 'open') AS tasks_open,
          (SELECT count(*) FROM tasks, bounds WHERE assignee_id = ${me} AND status = 'open' AND due_at >= bounds.day_start AND due_at < bounds.day_end) AS tasks_today,
          (SELECT count(*) FROM tasks WHERE assignee_id = ${me} AND status = 'open' AND due_at < now()) AS tasks_overdue,
          (SELECT count(*) FROM tasks, bounds WHERE assignee_id = ${me} AND status = 'open' AND remind_before_minutes IS NOT NULL AND due_at >= now() AND due_at < bounds.day_end) AS reminders_today,
          (SELECT count(*) FROM tasks WHERE assignee_id = ${me} AND status = 'open' AND remind_before_minutes IS NOT NULL AND due_at < now()) AS reminders_overdue,
          (SELECT count(*) FROM conversations WHERE assigned_to = ${me} AND status = 'open') AS conversations_open,
          (SELECT coalesce(sum(unread_count), 0) FROM conversations WHERE assigned_to = ${me} AND status = 'open') AS conversations_unread`);
      const { rows: recent } = await tx.execute<{ id: number; type: string; dealId: string; dealTitle: string; data: Record<string, unknown>; createdAt: Date }>(sql`
        SELECT e.id, e.type, e.deal_id AS "dealId", d.title AS "dealTitle", e.data, e.created_at AS "createdAt"
        FROM deal_events e JOIN deals d ON d.id = e.deal_id
        WHERE e.actor_id = ${me} ORDER BY e.created_at DESC, e.id DESC LIMIT 5`);
      const n = (key: string) => Number(c?.[key] ?? 0);
      return {
        deals: { open: n('deals_open'), wonThisMonth: n('deals_won_month') },
        tasks: { open: n('tasks_open'), today: n('tasks_today'), overdue: n('tasks_overdue') },
        reminders: { today: n('reminders_today'), overdue: n('reminders_overdue') },
        conversations: { open: n('conversations_open'), unread: n('conversations_unread') },
        recent,
      };
    });
  }
}

@Controller('v1/me')
@UseGuards(SessionGuard, PermissionGuard)
class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get('profile') @RequirePermission('settings:read')
  get(@CurrentAuth() auth: AuthContext) { return this.profile.get(auth); }

  @Patch('profile') @AllowWhenReadOnly() @NoAudit() @RequirePermission('settings:read')
  update(@CurrentAuth() auth: AuthContext, @ZodBody(updateProfileSchema) body: z.infer<typeof updateProfileSchema>) { return this.profile.update(auth, body); }

  @Post('avatar') @HttpCode(HttpStatus.OK) @AllowWhenReadOnly() @NoAudit() @RequirePermission('settings:read')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AVATAR_BYTES, files: 1 } }))
  avatar(@CurrentAuth() auth: AuthContext, @UploadedFile() file?: { buffer: Buffer; size: number }) { return this.profile.setAvatar(auth, file); }

  @Delete('avatar') @HttpCode(HttpStatus.NO_CONTENT) @AllowWhenReadOnly() @NoAudit() @RequirePermission('settings:read')
  removeAvatar(@CurrentAuth() auth: AuthContext) { return this.profile.removeAvatar(auth); }

  @Get('activity') @RequirePermission('records:read')
  activity(@CurrentAuth() auth: AuthContext) { return this.profile.activity(auth); }
}

@Module({
  imports: [IdentityModule],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
