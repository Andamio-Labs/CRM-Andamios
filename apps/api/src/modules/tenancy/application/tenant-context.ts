import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../../shared/database/database.js';
import { tenantSettings } from '../../../shared/database/schema.js';
import { withTenant } from '../../../shared/database/with-tenant.js';
import { badRequest } from '../../../shared/http/errors.js';
import { DB } from '../../../shared/tokens.js';
import { recordVisibility } from '../../identity/domain/permissions.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';

/**
 * Lo que todo caso de uso de datos de negocio necesita del tenant: transacción con RLS,
 * alcance de visibilidad (E01-S04), configuración regional y validación de responsables.
 */
@Injectable()
export class TenantContext {
  constructor(@Inject(DB) private readonly db: Database) {}

  run<T>(auth: AuthContext, work: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(this.db, auth.tenantId, work);
  }

  async settings(tx: Transaction) {
    const [row] = await tx.select().from(tenantSettings);
    return row!;
  }

  /** 'assigned' → el vendedor solo ve registros con owner_id = él. */
  async visibility(tx: Transaction, auth: AuthContext): Promise<'all' | 'assigned'> {
    if (auth.role !== 'member') return 'all';
    return recordVisibility(auth.role, await this.settings(tx));
  }

  /** Condición SQL de visibilidad para una columna owner_id, o undefined si ve todo. */
  async visibilityFilter(tx: Transaction, auth: AuthContext, ownerColumn: Parameters<typeof eq>[0]) {
    return (await this.visibility(tx, auth)) === 'assigned' ? eq(ownerColumn, auth.userId) : undefined;
  }

  /** Un responsable debe ser miembro del tenant (las FK a "user" no lo garantizan). */
  async assertMember(tx: Transaction, auth: AuthContext, userId: string) {
    const { rows } = await tx.execute(
      sql`SELECT 1 FROM member WHERE "organizationId" = ${auth.tenantId} AND "userId" = ${userId}`,
    );
    if (!rows.length) throw badRequest('El responsable no es parte del equipo');
  }
}

