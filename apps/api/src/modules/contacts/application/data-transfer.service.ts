import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../../shared/database/database.js';
import { auditLog, contacts, importJobs, tenantSettings } from '../../../shared/database/schema.js';
import { withTenant } from '../../../shared/database/with-tenant.js';
import { AppError } from '../../../shared/http/app-error.js';
import { badRequest } from '../../../shared/http/errors.js';
import type { JobQueue } from '../../../shared/queue/bull-queue.js';
import type { ObjectStorage } from '../../../shared/storage/object-storage.js';
import { DB, JOB_QUEUE, STORAGE } from '../../../shared/tokens.js';
import { PlanService } from '../../billing/plan.service.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { TenantContext } from '../../tenancy/application/tenant-context.js';
import { IMPORT_TARGETS, type ImportValues, MAX_IMPORT_ROWS, mapRow, suggestMapping } from '../domain/csv-import.js';
import { countryFromLocale } from '../domain/phone.js';
import { CustomFieldsService } from './custom-fields.service.js';

export const startImportSchema = z.object({ mapping: z.record(z.string(), z.string()) }).strict();
export const exportEntitySchema = z.enum(['contacts', 'deals', 'tasks']);

export interface ImportJob {
  tenantId: string;
  importId: string;
  actorId: string;
}

const BATCH = 500;
const CSV_TYPES = new Set(['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/csv']);

/** Excel/Sheets ejecutan celdas que empiezan con = + - @: se neutralizan con un apóstrofo. */
export const safeCell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join('; ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
};

/** E02-S08 importación y E02-S09 exportación. */
@Injectable()
export class DataTransferService {
  constructor(
    private readonly tenant: TenantContext,
    private readonly fields: CustomFieldsService,
    private readonly plans: PlanService,
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  /** Sube y analiza: vista previa + mapeo sugerido. Todavía no crea contactos. */
  async upload(auth: AuthContext, file: { originalname: string; mimetype: string; buffer: Buffer } | undefined) {
    if (!file) throw badRequest('Adjunta un archivo CSV');
    if (!file.originalname.toLowerCase().endsWith('.csv') || !CSV_TYPES.has(file.mimetype)) throw badRequest('El archivo debe ser un CSV');
    let records: string[][];
    try {
      records = parse(file.buffer, { bom: true, skip_empty_lines: true, relax_column_count: true });
    } catch {
      throw badRequest('No pudimos leer el CSV: revisa el formato y la codificación (UTF-8).');
    }
    const [headers, ...rows] = records;
    if (!headers?.length || !rows.length) throw badRequest('El archivo no tiene filas para importar');
    if (rows.length > MAX_IMPORT_ROWS) throw badRequest('Máximo 50.000 filas por archivo. Divide el archivo e impórtalo por partes.');
    await this.plans.assertStorage(auth.tenantId, file.buffer.length);

    const defs = await this.tenant.run(auth, (tx) => this.fields.definitions(tx, 'contact'));
    return this.tenant.run(auth, async (tx) => {
      const [job] = await tx.insert(importJobs).values({ tenantId: auth.tenantId, createdBy: auth.userId, fileKey: 'pendiente', headers, totalRows: rows.length }).returning();
      const fileKey = `t/${auth.tenantId}/imports/${job!.id}.csv`;
      await this.storage.put(fileKey, file.buffer, 'text/csv');
      await tx.update(importJobs).set({ fileKey }).where(eq(importJobs.id, job!.id));
      await this.plans.addStorage(tx, auth.tenantId, file.buffer.length);
      return {
        id: job!.id,
        headers,
        totalRows: rows.length,
        sample: rows.slice(0, 5).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))),
        suggestedMapping: suggestMapping(headers, defs.map((d) => d.key)),
      };
    });
  }

  async start(auth: AuthContext, id: string, { mapping }: z.infer<typeof startImportSchema>) {
    const job = await this.find(auth, id);
    if (job.status !== 'uploaded') throw new AppError(HttpStatus.CONFLICT, 'IMPORT_ALREADY_STARTED', 'Esta importación ya se procesó.');
    const defs = await this.tenant.run(auth, (tx) => this.fields.definitions(tx, 'contact'));
    const allowed = new Set(['', ...IMPORT_TARGETS, ...defs.map((d) => `custom.${d.key}`)]);
    for (const [column, target] of Object.entries(mapping)) {
      if (!job.headers.includes(column)) throw badRequest(`La columna "${column}" no está en el archivo`);
      if (!allowed.has(target)) throw badRequest(`No se puede importar en "${target}"`);
    }
    if (!Object.values(mapping).includes('name')) throw badRequest('Elige qué columna es el nombre');

    await this.tenant.run(auth, (tx) => tx.update(importJobs).set({ mapping, status: 'processing' }).where(eq(importJobs.id, id)));
    await this.queue.enqueue('imports', 'contacts.import', { tenantId: auth.tenantId, importId: id, actorId: auth.userId } satisfies ImportJob, { jobId: `import:${id}` });
    return this.get(auth, id);
  }

  async get(auth: AuthContext, id: string) {
    const { tenantId: _t, fileKey: _f, reportKey, ...job } = await this.find(auth, id);
    return { ...job, reportUrl: reportKey ? this.storage.signedUrl(reportKey, 24 * 3600) : null };
  }

  /**
   * Worker de importación: valida fila por fila, descarta duplicados (contra la base y dentro
   * del mismo archivo) e inserta por lotes. Lo que no entra queda en un reporte con fila y motivo.
   */
  async process({ tenantId, importId, actorId }: ImportJob) {
    const [job] = await withTenant(this.db, tenantId, (tx) => tx.select().from(importJobs).where(eq(importJobs.id, importId)));
    if (!job || job.status !== 'processing' || !job.mapping) return;
    const file = await this.storage.get(job.fileKey);
    if (!file) return this.finish(tenantId, importId, { status: 'failed' });

    const [, ...rows] = parse(file.body, { bom: true, skip_empty_lines: true, relax_column_count: true }) as string[][];
    const { defs, country, phones, emails } = await withTenant(this.db, tenantId, async (tx) => {
      const settings = (await tx.select().from(tenantSettings))[0]!;
      const existing = await tx.select({ phone: contacts.phone, email: contacts.email }).from(contacts);
      return {
        defs: await this.fields.definitions(tx, 'contact'),
        country: countryFromLocale(settings.locale),
        phones: new Set(existing.map((c) => c.phone).filter(Boolean)),
        emails: new Set(existing.map((c) => c.email?.toLowerCase()).filter(Boolean)),
      };
    });

    const errors: [number, string][] = [];
    const valid: ImportValues[] = [];
    rows.forEach((cells, index) => {
      const line = index + 2; // la fila 1 es el encabezado
      const result = mapRow(Object.fromEntries(job.headers.map((h, i) => [h, cells[i]])), job.mapping!, { defs, country });
      if (!result.ok) return void errors.push([line, result.error]);
      const { phone, email } = result.values;
      if (phone && phones.has(phone)) return void errors.push([line, `Duplicado: el teléfono ${phone} ya existe`]);
      if (email && emails.has(email)) return void errors.push([line, `Duplicado: el correo ${email} ya existe`]);
      if (phone) phones.add(phone);
      if (email) emails.add(email);
      valid.push(result.values);
    });

    for (let i = 0; i < valid.length; i += BATCH) {
      await withTenant(this.db, tenantId, (tx) =>
        tx.insert(contacts).values(valid.slice(i, i + BATCH).map((v) => ({ ...v, tenantId, ownerId: actorId, createdBy: actorId, source: v.source ?? 'importacion' }))),
      );
    }

    let reportKey: string | null = null;
    if (errors.length) {
      reportKey = `t/${tenantId}/imports/${importId}-errores.csv`;
      await this.storage.put(reportKey, Buffer.from(stringify([['fila', 'motivo'], ...errors.map(([l, e]) => [l, safeCell(e)])])), 'text/csv');
    }
    await this.finish(tenantId, importId, { status: 'done', imported: valid.length, skipped: errors.length, reportKey }, actorId);
  }

  /** E02-S09 — Exportación completa en CSV. Solo el propietario; queda en auditoría. */
  async export(auth: AuthContext, entity: z.infer<typeof exportEntitySchema>, ip: string | undefined) {
    return this.tenant.run(auth, async (tx) => {
      const queries = {
        contacts: sql`SELECT name AS nombre, phone AS telefono, email AS correo, array_to_string(tags, '; ') AS etiquetas, source AS origen,
                      campaign AS campana, priority AS prioridad, kind AS tipo, notes AS notas, custom_fields AS campos, created_at AS creado FROM contacts ORDER BY created_at`,
        deals: sql`SELECT d.title AS titulo, p.name AS embudo, s.name AS etapa, d.status AS estado, d.value AS valor, d.currency AS moneda,
                   d.probability AS probabilidad, d.expected_close_date AS cierre_estimado, d.source AS origen, c.name AS contacto, d.created_at AS creado
                   FROM deals d JOIN pipelines p ON p.id = d.pipeline_id JOIN stages s ON s.id = d.stage_id LEFT JOIN contacts c ON c.id = d.contact_id ORDER BY d.created_at`,
        tasks: sql`SELECT t.title AS titulo, t.status AS estado, t.due_at AS vence, d.title AS negocio, c.name AS contacto, t.created_at AS creada
                   FROM tasks t LEFT JOIN deals d ON d.id = t.deal_id LEFT JOIN contacts c ON c.id = t.contact_id ORDER BY t.created_at`,
      };
      const { rows, fields } = await tx.execute(queries[entity]);
      const header = fields.map((f) => f.name);
      await tx.insert(auditLog).values({ tenantId: auth.tenantId, actorId: auth.userId, action: 'export', entity, data: { rows: rows.length, ip: ip ?? null } });
      return stringify([header, ...rows.map((r) => header.map((h) => safeCell((r as Record<string, unknown>)[h])))]);
    });
  }

  private async finish(tenantId: string, importId: string, changes: Partial<typeof importJobs.$inferInsert>, actorId?: string) {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx.update(importJobs).set({ ...changes, finishedAt: new Date() }).where(eq(importJobs.id, importId));
      if (actorId) await tx.insert(auditLog).values({ tenantId, actorId, action: 'import', entity: 'contacts', entityId: importId, data: { imported: changes.imported, skipped: changes.skipped } });
    });
  }

  private async find(auth: AuthContext, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    const [job] = await this.tenant.run(auth, (tx) => tx.select().from(importJobs).where(eq(importJobs.id, id)));
    if (!job) throw new NotFoundException();
    return job;
  }
}
