import { Controller, Get, HttpCode, HttpStatus, Injectable, Module, Post, UseGuards } from '@nestjs/common';
import { asc, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { deals, pipelines, stages } from '../../shared/database/schema.js';
import { ZodBody } from '../../shared/http/zod-validation.pipe.js';
import { IdentityModule } from '../identity/identity.module.js';
import { type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';
import { PipelinesService } from '../pipeline/application/pipelines.service.js';
import { PipelineModule } from '../pipeline/pipeline.module.js';
import { TenantContext } from '../tenancy/application/tenant-context.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { ONBOARDING_STEPS, PIPELINE_TEMPLATE_IDS, PIPELINE_TEMPLATES, progressOf } from './domain/pipeline-templates.js';

export const applyTemplateSchema = z.object({ template: z.enum(PIPELINE_TEMPLATE_IDS) }).strict();

const STAGE_COLORS = ['#94a3b8', '#60a5fa', '#f5b700', '#a78bfa', '#34d399', '#f87171'];

/**
 * E14-S03 — Onboarding guiado. Cada paso se DERIVA de los datos (¿hay un número conectado?, ¿se importó?),
 * así nunca se desincroniza; la fecha de cada paso alimenta el embudo de activación (E08-S04).
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly tenant: TenantContext,
    private readonly pipelinesService: PipelinesService,
  ) {}

  status(auth: AuthContext) {
    return this.tenant.run(auth, async (tx) => {
      const { rows } = await tx.execute<{ whatsapp: Date | null; pipeline: Date | null; import: Date | null; team: Date | null; dismissed: Date | null }>(sql`
        SELECT (SELECT min(connected_at) FROM whatsapp_channels) AS whatsapp,
               (SELECT pipeline_chosen_at FROM tenant_onboarding) AS pipeline,
               (SELECT min(finished_at) FROM import_jobs WHERE status = 'done') AS import,
               (SELECT min("createdAt") FROM invitation WHERE "organizationId" = ${auth.tenantId}) AS team,
               (SELECT dismissed_at FROM tenant_onboarding) AS dismissed`);
      const at = rows[0]!;
      const steps = ONBOARDING_STEPS.map((s) => ({ ...s, done: Boolean(at[s.key]), doneAt: at[s.key] }));
      const progress = progressOf(steps.map((s) => s.done));
      return { steps, progress, completed: progress === 100, dismissed: Boolean(at.dismissed) };
    });
  }

  /** Embudo inicial todavía vacío → se transforma en el de la plantilla; si ya tiene negocios, se crea uno nuevo. */
  async applyTemplate(auth: AuthContext, { template }: z.infer<typeof applyTemplateSchema>) {
    const def = PIPELINE_TEMPLATES[template];
    const reused = await this.tenant.run(auth, async (tx) => {
      const [first] = await tx.select().from(pipelines).orderBy(asc(pipelines.position), asc(pipelines.createdAt)).limit(1);
      const [used] = first ? await tx.select({ n: count() }).from(deals).where(eq(deals.pipelineId, first.id)) : [{ n: 1 }];
      if (!first || used!.n > 0) return false;
      await tx.delete(stages).where(eq(stages.pipelineId, first.id));
      await tx.insert(stages).values(def.stages.map((name, i) => ({ tenantId: auth.tenantId, pipelineId: first.id, name, position: i, color: STAGE_COLORS[i % STAGE_COLORS.length]! })));
      await tx.update(pipelines).set({ name: def.name }).where(eq(pipelines.id, first.id));
      return true;
    });
    if (!reused) await this.pipelinesService.create(auth, { name: def.name, stages: def.stages.map((name) => ({ name })) });
    await this.tenant.run(auth, (tx) => tx.execute(sql`
      INSERT INTO tenant_onboarding (tenant_id, pipeline_template, pipeline_chosen_at) VALUES (${auth.tenantId}, ${template}, now())
      ON CONFLICT (tenant_id) DO UPDATE SET pipeline_template = excluded.pipeline_template, pipeline_chosen_at = coalesce(tenant_onboarding.pipeline_chosen_at, now())`));
    return this.status(auth);
  }

  dismiss(auth: AuthContext) {
    return this.tenant.run(auth, async (tx) => {
      await tx.execute(sql`INSERT INTO tenant_onboarding (tenant_id, dismissed_at) VALUES (${auth.tenantId}, now())
        ON CONFLICT (tenant_id) DO UPDATE SET dismissed_at = now()`);
    });
  }
}

@Controller('v1/onboarding')
@UseGuards(SessionGuard, PermissionGuard)
class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get() @RequirePermission('settings:read')
  status(@CurrentAuth() auth: AuthContext) { return this.onboarding.status(auth); }

  @Get('pipeline-templates') @RequirePermission('settings:read')
  templates() { return PIPELINE_TEMPLATE_IDS.map((id) => ({ id, label: PIPELINE_TEMPLATES[id].label, name: PIPELINE_TEMPLATES[id].name, stages: PIPELINE_TEMPLATES[id].stages })); }

  @Post('pipeline-template') @HttpCode(HttpStatus.OK) @RequirePermission('pipelines:manage')
  apply(@CurrentAuth() auth: AuthContext, @ZodBody(applyTemplateSchema) body: z.infer<typeof applyTemplateSchema>) { return this.onboarding.applyTemplate(auth, body); }

  @Post('dismiss') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('pipelines:manage')
  dismiss(@CurrentAuth() auth: AuthContext) { return this.onboarding.dismiss(auth); }
}

/** E14-S03 — Onboarding guiado. */
@Module({
  imports: [IdentityModule, TenancyModule, PipelineModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
