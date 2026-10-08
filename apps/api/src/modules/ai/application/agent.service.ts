import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Env } from '../../../config/env.js';
import type { Transaction } from '../../../shared/database/database.js';
import { aiAgents, aiInteractions } from '../../../shared/database/schema.js';
import { AppError } from '../../../shared/http/app-error.js';
import { ENV } from '../../../shared/tokens.js';
import { CustomFieldsService } from '../../contacts/application/custom-fields.service.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { TenantContext } from '../../tenancy/application/tenant-context.js';
import { AGENT_LANGUAGES, AGENT_SCHEDULES, AGENT_TONES, buildAgentPrompt } from '../domain/agent-prompt.js';
import { costMicros } from '../domain/cost.js';
import { DEFAULT_HANDOFF_KEYWORDS } from '../domain/handoff.js';
import { DEFAULT_QUALIFICATION, qualificationTargets } from '../domain/qualification.js';
import { AgentRuntime } from './agent-runtime.js';
import { KnowledgeRetriever } from './knowledge-retriever.js';

export const updateAgentSchema = z.object({
  name: z.string().trim().min(1).max(60),
  tone: z.enum(AGENT_TONES),
  language: z.enum(AGENT_LANGUAGES),
  schedule: z.enum(AGENT_SCHEDULES),
  instructions: z.string().max(8000),
  enabled: z.boolean(),
  handoffKeywords: z.array(z.string().trim().min(2).max(40)).max(20),
  qualification: z.array(z.string().max(80)).max(15),
  blockOnQuota: z.boolean(),
}).partial().strict();
export const previewSchema = z.object({ message: z.string().trim().min(1).max(1000) }).strict();

type AgentRow = typeof aiAgents.$inferSelect;
const DEFAULTS: Omit<AgentRow, 'tenantId' | 'updatedBy' | 'updatedAt'> = {
  name: 'Asistente', tone: 'friendly', language: 'es-CO', schedule: 'always', instructions: '', enabled: false,
  handoffKeywords: DEFAULT_HANDOFF_KEYWORDS, qualification: DEFAULT_QUALIFICATION, blockOnQuota: true,
};

/** E05-S01/S04/S05/S06 — Configuración del agente y simulador (mismo turno que en WhatsApp, sin enviar nada). */
@Injectable()
export class AgentService {
  constructor(
    private readonly tenant: TenantContext,
    private readonly runtime: AgentRuntime,
    private readonly retriever: KnowledgeRetriever,
    private readonly fields: CustomFieldsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get(auth: AuthContext) {
    return this.tenant.run(auth, async (tx) => this.view(tx, await this.load(tx)));
  }

  update(auth: AuthContext, input: z.infer<typeof updateAgentSchema>) {
    if (input.enabled && !this.runtime.configured) {
      throw new AppError(HttpStatus.CONFLICT, 'AI_NOT_CONFIGURED', 'El agente se activa cuando haya un proveedor de IA configurado');
    }
    return this.tenant.run(auth, async (tx) => {
      if (input.qualification) {
        const valid = new Set((await this.targets(tx)).map((t) => t.target));
        const unknown = input.qualification.filter((t) => !valid.has(t));
        if (unknown.length) throw new AppError(HttpStatus.BAD_REQUEST, 'INVALID_QUALIFICATION', `No se puede capturar en: ${unknown.join(', ')}`);
      }
      const changes = {
        ...input,
        ...(input.handoffKeywords ? { handoffKeywords: [...new Set(input.handoffKeywords.map((k) => k.toLowerCase()))] } : {}),
        ...(input.qualification ? { qualification: [...new Set(input.qualification)] } : {}),
        updatedBy: auth.userId, updatedAt: new Date(),
      };
      const [row] = await tx.insert(aiAgents).values({ ...DEFAULTS, ...changes, tenantId: auth.tenantId })
        .onConflictDoUpdate({ target: aiAgents.tenantId, set: changes }).returning();
      return this.view(tx, row!);
    });
  }

  /** Corre el turno completo (búsqueda, modelo y guardrails) y lo registra como "simulador": no cuenta para la cuota. */
  async preview(auth: AuthContext, { message }: z.infer<typeof previewSchema>) {
    const ctx = await this.tenant.run(auth, async (tx) => {
      const agent = await this.load(tx);
      const { rows } = await tx.execute<{ name: string }>(sql`SELECT name FROM organization WHERE id = ${auth.tenantId}`);
      const capture = (await this.targets(tx)).filter((t) => agent.qualification.includes(t.target));
      return { agent, capture, companyName: rows[0]?.name ?? '' };
    });
    if (!this.runtime.configured) {
      return { systemPrompt: buildAgentPrompt(ctx.agent, { companyName: ctx.companyName, capture: ctx.capture }), reply: null, aiConfigured: false };
    }
    const turn = await this.runtime.respond({ tenantId: auth.tenantId, companyName: ctx.companyName, agent: ctx.agent, history: [{ role: 'user', content: message }], capture: ctx.capture });
    await this.tenant.run(auth, (tx) => tx.insert(aiInteractions).values({
      tenantId: auth.tenantId, channel: 'preview', outcome: turn.outcome, model: turn.model, prompt: turn.prompt, response: turn.response,
      inputTokens: turn.inputTokens, outputTokens: turn.outputTokens, latencyMs: turn.latencyMs, violations: turn.violations, sources: turn.sources, error: turn.error,
      costMicros: costMicros(turn.inputTokens, turn.outputTokens, { inputPerMTok: this.env.LLM_PRICE_INPUT_PER_MTOK, outputPerMTok: this.env.LLM_PRICE_OUTPUT_PER_MTOK }),
    }));
    return {
      systemPrompt: turn.prompt.system, reply: turn.reply, aiConfigured: true,
      outcome: turn.outcome, handoff: turn.handoff, fields: turn.fields, sources: turn.sources, violations: turn.violations, latencyMs: turn.latencyMs,
    };
  }

  private targets(tx: Transaction) {
    return Promise.all([this.fields.definitions(tx, 'contact'), this.fields.definitions(tx, 'deal')])
      .then(([contact, deal]) => qualificationTargets({ contact, deal }));
  }

  private async load(tx: Transaction): Promise<Omit<AgentRow, 'tenantId'>> {
    const [row] = await tx.select().from(aiAgents);
    return row ?? { ...DEFAULTS, updatedBy: null, updatedAt: new Date(0) };
  }

  private async view(tx: Transaction, { tenantId: _t, updatedBy: _u, ...agent }: Partial<AgentRow> & Omit<AgentRow, 'tenantId'>) {
    return {
      ...agent,
      aiConfigured: this.runtime.configured,
      knowledgeConfigured: this.retriever.configured,
      qualificationOptions: await this.targets(tx),
    };
  }
}
