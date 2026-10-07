import { sql } from 'drizzle-orm';
import type { Database, Transaction } from './database.js';

/**
 * Ejecuta `work` dentro de una transacción con el tenant activo seteado para RLS.
 *
 * Usa set_config(..., is_local = true) ≡ SET LOCAL: el valor muere con la transacción,
 * así una conexión reciclada del pool nunca arrastra el tenant anterior.
 * Es compatible con PgBouncer en modo transacción.
 */
export async function withTenant<T>(db: Database, tenantId: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
  if (!tenantId?.trim()) {
    throw new Error('withTenant: se requiere un tenant para acceder a datos aislados');
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return work(tx);
  });
}
