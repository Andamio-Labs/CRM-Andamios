import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import type { Env } from '../../../config/env.js';
import type { Database } from '../../../shared/database/database.js';
import { subscriptions, tenantSettings } from '../../../shared/database/schema.js';
import { withTenant } from '../../../shared/database/with-tenant.js';
import { AUTH, DB, ENV, PG_POOL } from '../../../shared/tokens.js';
import { seedPipelineDefaults } from '../../pipeline/application/pipelines.service.js';
import { DEFAULT_BUSINESS_HOURS, DEFAULT_OUT_OF_HOURS_MESSAGE } from '../../tenancy/domain/tenant-settings.js';
import { type AcceptanceContext, LegalService } from '../../legal/legal.module.js';
import type { Auth } from '../infrastructure/auth.js';
import { PASSWORD_MIN_LENGTH } from '../infrastructure/auth.js';

export const registerCompanySchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(128),
  // E13-S01: sin aceptar términos y privacidad no hay cuenta.
  acceptLegal: z.literal(true, { error: 'Debes aceptar los términos y el aviso de privacidad' }),
});
export type RegisterCompanyInput = z.infer<typeof registerCompanySchema>;

/**
 * E01-S01 — Registro de empresa + usuario propietario + plan de prueba.
 *
 * Si el correo ya existe NO lo decimos (evita enumeración de cuentas): la respuesta es idéntica.
 * Better Auth y nuestras tablas no comparten transacción; si algo falla después de crear
 * el usuario, compensamos borrándolo para que pueda reintentar.
 */
@Injectable()
export class RegisterCompany {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(DB) private readonly db: Database,
    @Inject(PG_POOL) private readonly conn: { pool: pg.Pool },
    @Inject(ENV) private readonly env: Env,
    private readonly legal: LegalService,
  ) {}

  async execute(input: RegisterCompanyInput, context: AcceptanceContext): Promise<void> {
    const existing = await this.conn.pool.query(`SELECT 1 FROM "user" WHERE email = $1`, [input.email]);
    if (existing.rowCount) return;

    let user: { id: string };
    try {
      ({ user } = await this.auth.api.signUpEmail({
        body: {
          name: input.name,
          email: input.email,
          password: input.password,
          callbackURL: `${this.env.APP_URL}/login?verified=1`,
        },
      }));
    } catch (error) {
      // Carrera (doble envío del formulario): otro request creó el usuario entre el chequeo y el alta.
      // Respondemos igual que si ya existía: no se revela nada y no hay 500.
      const exists = await this.conn.pool.query(`SELECT 1 FROM "user" WHERE email = $1`, [input.email]);
      if (exists.rowCount) return;
      throw error;
    }

    let orgId: string | undefined;
    try {
      const org = await this.auth.api.createOrganization({
        body: { name: input.companyName, slug: slugify(input.companyName), userId: user.id },
      });
      if (!org) throw new Error('No se pudo crear la organización');
      orgId = org.id;

      const trialEndsAt = new Date(Date.now() + this.env.TRIAL_DAYS * 86_400_000);
      await withTenant(this.db, org.id, async (tx) => {
        await tx.insert(tenantSettings).values({ tenantId: org.id, businessHours: DEFAULT_BUSINESS_HOURS, outOfHoursMessage: DEFAULT_OUT_OF_HOURS_MESSAGE });
        await tx.insert(subscriptions).values({ tenantId: org.id, plan: 'trial', status: 'trialing', trialEndsAt });
        await seedPipelineDefaults(tx, org.id);
      });
      await this.legal.recordAcceptance(user.id, context);
    } catch (error) {
      // Auditoría #9: compensación completa, sin tenants huérfanos.
      if (orgId) await this.conn.pool.query(`DELETE FROM organization WHERE id = $1`, [orgId]);
      await this.conn.pool.query(`DELETE FROM "user" WHERE id = $1`, [user.id]);
      throw error;
    }
  }
}

function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${base || 'empresa'}-${randomBytes(3).toString('hex')}`;
}
