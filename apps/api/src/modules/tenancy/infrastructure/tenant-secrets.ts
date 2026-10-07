import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { SecretBox } from '../../../shared/crypto/secret-box.js';
import type { Database } from '../../../shared/database/database.js';
import { tenantSecrets } from '../../../shared/database/schema.js';
import { withTenant } from '../../../shared/database/with-tenant.js';
import { DB } from '../../../shared/tokens.js';

/**
 * E13-S05 — Secretos por tenant (tokens de Meta, claves de pasarelas…).
 * Doble barrera: RLS (otro tenant no ve la fila) + AAD (una fila copiada no descifra).
 * NUNCA loguear ni devolver por API el valor descifrado.
 */
@Injectable()
export class TenantSecrets {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly box: SecretBox,
  ) {}

  async put(tenantId: string, name: string, value: string): Promise<void> {
    const ciphertext = this.box.encrypt(value, this.context(tenantId, name));
    await withTenant(this.db, tenantId, (tx) =>
      tx
        .insert(tenantSecrets)
        .values({ tenantId, name, ciphertext })
        .onConflictDoUpdate({ target: [tenantSecrets.tenantId, tenantSecrets.name], set: { ciphertext, updatedAt: sql`now()` } }),
    );
  }

  async get(tenantId: string, name: string): Promise<string | null> {
    const [row] = await withTenant(this.db, tenantId, (tx) =>
      tx.select().from(tenantSecrets).where(and(eq(tenantSecrets.tenantId, tenantId), eq(tenantSecrets.name, name))),
    );
    return row ? this.box.decrypt(row.ciphertext, this.context(tenantId, name)) : null;
  }

  private context(tenantId: string, name: string) {
    return `${tenantId}:${name}`;
  }
}
