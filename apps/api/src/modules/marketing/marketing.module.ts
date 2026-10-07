import { Controller, Get, Inject, Injectable, Module, NotFoundException, Param, Post, Res, UseGuards } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import type { Response } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { Database } from '../../shared/database/database.js';
import { waLinks, whatsappChannels } from '../../shared/database/schema.js';
import { withTenant } from '../../shared/database/with-tenant.js';
import { ZodBody } from '../../shared/http/zod-validation.pipe.js';
import { DB, ENV, PG_POOL } from '../../shared/tokens.js';
import { IdentityModule } from '../identity/identity.module.js';
import { type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';
import { buildWaUrl } from './domain/wa-link.js';

const utm = z.string().trim().max(100).regex(/^[\w.-]+$/, 'Solo letras, números, guiones y puntos').optional();
export const createLinkSchema = z.object({
  channelId: z.uuid(),
  message: z.string().trim().min(1).max(500),
  utmSource: utm,
  utmMedium: utm,
  utmCampaign: utm,
}).strict();

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // sin 0/o ni 1/l: se dictan sin confundirse
const newCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/** E09-S01 — Enlaces Click-to-WhatsApp con UTM: el clic se cuenta y el primer mensaje trae la campaña. */
@Injectable()
export class WaLinksService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PG_POOL) private readonly conn: { pool: pg.Pool },
    @Inject(ENV) private readonly env: Env,
  ) {}

  list(auth: AuthContext) {
    return withTenant(this.db, auth.tenantId, async (tx) =>
      (await tx.select().from(waLinks).orderBy(desc(waLinks.createdAt))).map((l) => this.view(l)));
  }

  create(auth: AuthContext, input: z.infer<typeof createLinkSchema>) {
    return withTenant(this.db, auth.tenantId, async (tx) => {
      const [channel] = await tx.select().from(whatsappChannels).where(eq(whatsappChannels.id, input.channelId));
      if (!channel?.displayPhone) throw new NotFoundException('El número no existe o no tiene teléfono visible');
      const { channelId: _c, ...rest } = input;
      const [row] = await tx.insert(waLinks).values({ ...rest, tenantId: auth.tenantId, code: newCode(), phone: channel.displayPhone }).returning();
      return this.view(row!);
    });
  }

  /** Clic público (sin sesión): se resuelve por código con la función acotada y se cuenta en el tenant. */
  async resolve(code: string): Promise<string | null> {
    if (!/^[a-z0-9]{6,12}$/.test(code)) return null;
    const { rows } = await this.conn.pool.query<{ tenant_id: string; link_id: string; phone: string; message: string }>(`SELECT * FROM wa_link_resolve($1)`, [code]);
    const link = rows[0];
    if (!link) return null;
    await withTenant(this.db, link.tenant_id, (tx) => tx.update(waLinks).set({ clicks: sql`${waLinks.clicks} + 1` }).where(eq(waLinks.id, link.link_id)));
    return buildWaUrl(link.phone, link.message, code);
  }

  private view({ tenantId: _t, ...link }: typeof waLinks.$inferSelect) {
    return { ...link, url: `${this.env.API_URL}/l/${link.code}`, waUrl: buildWaUrl(link.phone, link.message, link.code) };
  }
}

@Controller('v1/wa-links')
@UseGuards(SessionGuard, PermissionGuard)
class WaLinksController {
  constructor(private readonly links: WaLinksService) {}

  @Get() @RequirePermission('records:read')
  list(@CurrentAuth() auth: AuthContext) { return this.links.list(auth); }

  @Post() @RequirePermission('templates:manage')
  create(@CurrentAuth() auth: AuthContext, @ZodBody(createLinkSchema) body: z.infer<typeof createLinkSchema>) { return this.links.create(auth, body); }
}

/** GET /l/:code — fuera de /api (es el enlace que se publica en anuncios y redes). */
@Controller('l')
class WaLinkRedirectController {
  constructor(private readonly links: WaLinksService) {}

  @Get(':code')
  async redirect(@Param('code') code: string, @Res() res: Response) {
    const target = await this.links.resolve(code);
    if (!target) throw new NotFoundException();
    res.redirect(302, target);
  }
}

@Module({ imports: [IdentityModule], controllers: [WaLinksController, WaLinkRedirectController], providers: [WaLinksService] })
export class MarketingModule {}
