import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Env } from '../../../config/env.js';
import type { Database } from '../../../shared/database/database.js';
import { withTenant } from '../../../shared/database/with-tenant.js';
import { AppError } from '../../../shared/http/app-error.js';
import type { Mailer } from '../../../shared/mail/mailer.js';
import type { ObjectStorage } from '../../../shared/storage/object-storage.js';
import { DB, ENV, MAILER, STORAGE } from '../../../shared/tokens.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';

export const confirmDeletionSchema = z.object({ code: z.string().regex(/^\d{6}$/), companyName: z.string().min(1).max(200) }).strict();

const CODE_TTL_MS = 30 * 60_000;
const MAX_ATTEMPTS = 5;
type Failure = 'DELETION_NOT_REQUESTED' | 'DELETION_CODE_INVALID' | 'DELETION_CODE_LOCKED' | 'COMPANY_NAME_MISMATCH';
const FAILURES: Record<Failure, [HttpStatus, string]> = {
  DELETION_NOT_REQUESTED: [HttpStatus.NOT_FOUND, 'Primero pide el código de eliminación'],
  DELETION_CODE_INVALID: [HttpStatus.BAD_REQUEST, 'El código no es válido o venció; pide uno nuevo'],
  DELETION_CODE_LOCKED: [HttpStatus.BAD_REQUEST, 'Demasiados intentos; pide un código nuevo'],
  COMPANY_NAME_MISMATCH: [HttpStatus.BAD_REQUEST, 'El nombre de la empresa no coincide'],
};

/**
 * E13-S04 — Eliminación de la empresa con doble confirmación (código por correo + nombre exacto).
 * Borra con `purge_tenant()`: todo cae en cascada por tenant_id; los backups se purgan solos a los 30 días
 * (E15-S04) y restore.sh reaplica las eliminaciones registradas (docs/eliminacion-de-datos.md).
 */
@Injectable()
export class TenantDeletionService {
  private readonly logger = new Logger(TenantDeletionService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async requestDeletion(auth: AuthContext) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const companyName = await withTenant(this.db, auth.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO tenant_deletion_codes (tenant_id, code_hash, attempts, expires_at)
        VALUES (${auth.tenantId}, ${this.hash(auth.tenantId, code)}, 0, ${new Date(Date.now() + CODE_TTL_MS)})
        ON CONFLICT (tenant_id) DO UPDATE SET code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at`);
      const { rows } = await tx.execute<{ name: string }>(sql`SELECT name FROM organization WHERE id = ${auth.tenantId}`);
      return rows[0]!.name;
    });
    await this.mailer.send({
      to: auth.email,
      subject: `Código para eliminar ${companyName} de BeeCRM`,
      text: `Tu código para eliminar la empresa ${companyName} y TODOS sus datos es: ${code}\n\nVence en 30 minutos. Si no lo pediste, ignora este correo y cambia tu contraseña.`,
      html: `<p>Tu código para eliminar la empresa <strong>${escapeHtml(companyName)}</strong> y <strong>todos</strong> sus datos es:</p><p style="font-size:24px;letter-spacing:4px"><strong>${code}</strong></p><p>Vence en 30 minutos. Si no lo pediste, ignora este correo y cambia tu contraseña.</p>`,
    });
    return { requested: true, expiresInMinutes: CODE_TTL_MS / 60_000 };
  }

  async deleteTenant(auth: AuthContext, input: z.infer<typeof confirmDeletionSchema>) {
    // Los intentos fallidos se guardan (commit) antes de responder el error.
    const failure = await withTenant(this.db, auth.tenantId, async (tx): Promise<Failure | null> => {
      const { rows } = await tx.execute<{ code_hash: string; attempts: number; expires_at: Date; name: string }>(sql`
        SELECT c.code_hash, c.attempts, c.expires_at, o.name FROM tenant_deletion_codes c JOIN organization o ON o.id = c.tenant_id FOR UPDATE OF c`);
      const pending = rows[0];
      if (!pending) return 'DELETION_NOT_REQUESTED';
      if (pending.attempts >= MAX_ATTEMPTS) return 'DELETION_CODE_LOCKED';
      if (new Date(pending.expires_at) < new Date()) return 'DELETION_CODE_INVALID';
      const codeOk = safeEqual(pending.code_hash, this.hash(auth.tenantId, input.code));
      const nameOk = input.companyName === pending.name;
      if (codeOk && nameOk) return null;
      await tx.execute(sql`UPDATE tenant_deletion_codes SET attempts = attempts + 1`);
      return codeOk ? 'COMPANY_NAME_MISMATCH' : 'DELETION_CODE_INVALID';
    });
    if (failure) {
      const [status, message] = FAILURES[failure];
      throw new AppError(status, failure, message);
    }

    await withTenant(this.db, auth.tenantId, (tx) => tx.execute(sql`SELECT purge_tenant(${auth.tenantId})`));
    await this.storage.deletePrefix(`t/${auth.tenantId}`).catch((error: Error) => this.logger.error(`Archivos de ${auth.tenantId}: ${error.message}`));
    this.logger.warn(`Empresa ${auth.tenantId} eliminada por su propietario`);
    return { deleted: true };
  }

  private hash(tenantId: string, code: string) {
    return createHmac('sha256', this.env.BETTER_AUTH_SECRET).update(`${tenantId}:${code}`).digest('hex');
  }
}

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
