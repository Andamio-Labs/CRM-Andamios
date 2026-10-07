import { Controller, Get, Inject, Injectable, Module } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../shared/database/database.js';
import { DB } from '../../shared/tokens.js';

/**
 * E13-S01 — Versiones vigentes. Al publicar un texto nuevo se sube la versión y se pide
 * aceptar otra vez. Los textos en apps/web/src/features/legal están PENDIENTES de revisión
 * por abogado (criterio de la story): no se presentan como definitivos.
 */
export const LEGAL_DOCUMENTS = {
  terms: { version: '2026-10-06', title: 'Términos y condiciones' },
  privacy: { version: '2026-10-06', title: 'Aviso de privacidad y tratamiento de datos (Ley 1581 de 2012)' },
} as const;

export interface AcceptanceContext {
  ip: string | undefined;
  userAgent: string | undefined;
}

@Injectable()
export class LegalService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Registra la aceptación de AMBOS documentos en su versión vigente (append-only). */
  async recordAcceptance(userId: string, context: AcceptanceContext, tx: Database | Transaction = this.db) {
    for (const [document, { version }] of Object.entries(LEGAL_DOCUMENTS)) {
      await tx.execute(sql`
        INSERT INTO legal_acceptances (user_id, document, version, ip, user_agent)
        VALUES (${userId}, ${document}, ${version}, ${context.ip ?? null}::inet, ${context.userAgent?.slice(0, 400) ?? null})`);
    }
  }
}

@Controller('v1/legal')
class LegalController {
  @Get()
  current() {
    return LEGAL_DOCUMENTS;
  }
}

@Module({ controllers: [LegalController], providers: [LegalService], exports: [LegalService] })
export class LegalModule {}
