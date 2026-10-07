import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Transaction } from '../../../shared/database/database.js';
import { contacts, customFieldDefinitions, type CustomFieldEntity, deals } from '../../../shared/database/schema.js';
import { AppError } from '../../../shared/http/app-error.js';
import { isUniqueViolation } from '../../../shared/http/errors.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { TenantContext } from '../../tenancy/application/tenant-context.js';
import { type FieldDefinition, MAX_CUSTOM_FIELDS_PER_ENTITY } from '../domain/custom-fields.js';

export const entitySchema = z.enum(['contact', 'deal']);

const options = z.array(z.string().trim().min(1).max(80)).max(100).refine((o) => new Set(o).size === o.length, 'Opciones repetidas');

export const createFieldSchema = z
  .object({
    entity: entitySchema,
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Solo minúsculas, números y _ (empieza con letra)'),
    label: z.string().trim().min(1).max(80),
    type: z.enum(['text', 'number', 'date', 'select', 'multiselect', 'currency']),
    options: options.default([]),
  })
  .strict()
  .refine((f) => !['select', 'multiselect'].includes(f.type) || f.options.length > 0, 'Las listas necesitan opciones');

export const updateFieldSchema = z.object({ label: z.string().trim().min(1).max(80), options, position: z.number().int().min(0) }).partial().strict();

/** E02-S04 — Definiciones de campos personalizados por tenant. */
@Injectable()
export class CustomFieldsService {
  constructor(private readonly tenant: TenantContext) {}

  list(auth: AuthContext, entity: CustomFieldEntity) {
    return this.tenant.run(auth, (tx) => this.definitions(tx, entity));
  }

  /** Para validar valores dentro de la misma transacción del caso de uso. */
  definitions(tx: Transaction, entity: CustomFieldEntity): Promise<(FieldDefinition & { id: string })[]> {
    return tx
      .select({ id: customFieldDefinitions.id, key: customFieldDefinitions.key, label: customFieldDefinitions.label, type: customFieldDefinitions.type, options: customFieldDefinitions.options, position: customFieldDefinitions.position })
      .from(customFieldDefinitions)
      .where(eq(customFieldDefinitions.entity, entity))
      .orderBy(asc(customFieldDefinitions.position), asc(customFieldDefinitions.createdAt));
  }

  async create(auth: AuthContext, input: z.infer<typeof createFieldSchema>) {
    try {
      return await this.tenant.run(auth, async (tx) => {
        // Serializa las altas del tenant para que dos requests simultáneas no superen el máximo.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`fields:${auth.tenantId}:${input.entity}`}))`);
        const [{ count }] = (await tx.execute(
          sql`SELECT count(*)::int AS count FROM custom_field_definitions WHERE entity = ${input.entity}`,
        )).rows as [{ count: number }];
        if (count >= MAX_CUSTOM_FIELDS_PER_ENTITY) {
          throw new AppError(HttpStatus.CONFLICT, 'CUSTOM_FIELD_LIMIT_REACHED', `Máximo ${MAX_CUSTOM_FIELDS_PER_ENTITY} campos por entidad.`);
        }
        const [row] = await tx.insert(customFieldDefinitions).values({ ...input, tenantId: auth.tenantId, position: count }).returning();
        return row!;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError(HttpStatus.CONFLICT, 'CUSTOM_FIELD_EXISTS', `Ya existe el campo "${input.key}".`);
      throw error;
    }
  }

  async update(auth: AuthContext, id: string, changes: z.infer<typeof updateFieldSchema>) {
    return this.tenant.run(auth, async (tx) => {
      const [row] = await tx.update(customFieldDefinitions).set(changes).where(eq(customFieldDefinitions.id, id)).returning();
      if (!row) throw new NotFoundException();
      return row;
    });
  }

  /** Borra la definición y sus valores en todos los registros (no dejamos datos huérfanos en el JSON). */
  async remove(auth: AuthContext, id: string) {
    await this.tenant.run(auth, async (tx) => {
      const [def] = await tx.delete(customFieldDefinitions).where(eq(customFieldDefinitions.id, id)).returning();
      if (!def) throw new NotFoundException();
      const table = def.entity === 'contact' ? contacts : deals;
      await tx
        .update(table)
        .set({ customFields: sql`${table.customFields} - ${def.key}` })
        .where(and(sql`${table.customFields} ? ${def.key}`));
    });
  }
}
