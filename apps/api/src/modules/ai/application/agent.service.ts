import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Transaction } from '../../../shared/database/database.js';
import { aiAgents } from '../../../shared/database/schema.js';
import type { LlmProvider } from '../../../shared/ai/llm.js';
import { AppError } from '../../../shared/http/app-error.js';
import { LLM_PROVIDER } from '../../../shared/tokens.js';
import type { AuthContext } from '../../identity/infrastructure/http/session.guard.js';
import { TenantContext } from '../../tenancy/application/tenant-context.js';
import { AGENT_LANGUAGES, AGENT_SCHEDULES, AGENT_TONES, buildAgentPrompt } from '../domain/agent-prompt.js';

export const updateAgentSchema = z.object({
  name: z.string().trim().min(1).max(60),
  tone: z.enum(AGENT_TONES),
  language: z.enum(AGENT_LANGUAGES),
  schedule: z.enum(AGENT_SCHEDULES),
  instructions: z.string().max(8000),
  enabled: z.boolean(),
}).partial().strict();
export const previewSchema = z.object({ message: z.string().trim().min(1).max(1000) }).strict();

type AgentRow = typeof aiAgents.$inferSelect;
const DEFAULTS: Omit<AgentRow, 'tenantId' | 'updatedBy' | 'updatedAt'> = {
  name: 'Asistente', tone: 'friendly', language: 'es-CO', schedule: 'always', instructions: '', enabled: false,
};

/** E05-S01 — Configuración del agente y simulador. Sin proveedor real, el simulador muestra el prompt y avisa. */
@Injectable()
export class AgentService {
  constructor(
    private readonly tenant: TenantContext,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  get(auth: AuthContext) {
    return this.tenant.run(auth, async (tx) => this.view(await this.load(tx)));
  }

  update(auth: AuthContext, input: z.infer<typeof updateAgentSchema>) {
    if (input.enabled && !this.llm.configured) {
      throw new AppError(HttpStatus.CONFLICT, 'AI_NOT_CONFIGURED', 'El agente se activa cuando haya un proveedor de IA configurado');
    }
    return this.tenant.run(auth, async (tx) => {
      const changes = { ...input, updatedBy: auth.userId, updatedAt: new Date() };
      const [row] = await tx.insert(aiAgents).values({ ...DEFAULTS, ...changes, tenantId: auth.tenantId })
        .onConflictDoUpdate({ target: aiAgents.tenantId, set: changes }).returning();
      return this.view(row!);
    });
  }

  preview(auth: AuthContext, { message }: z.infer<typeof previewSchema>) {
    return this.tenant.run(auth, async (tx) => {
      const agent = await this.load(tx);
      const { rows } = await tx.execute<{ name: string }>(sql`SELECT name FROM organization WHERE id = ${auth.tenantId}`);
      const systemPrompt = buildAgentPrompt(agent, { companyName: rows[0]?.name ?? '' });
      if (!this.llm.configured) return { systemPrompt, reply: null, aiConfigured: false };
      const res = await this.llm.complete({ system: systemPrompt, messages: [{ role: 'user', content: message }], maxTokens: 500 });
      return { systemPrompt, reply: res.text, aiConfigured: true };
    });
  }

  private async load(tx: Transaction): Promise<Omit<AgentRow, 'tenantId'>> {
    const [row] = await tx.select().from(aiAgents);
    return row ?? { ...DEFAULTS, updatedBy: null, updatedAt: new Date(0) };
  }

  private view({ tenantId: _t, updatedBy: _u, ...agent }: Partial<AgentRow> & Omit<AgentRow, 'tenantId'>) {
    return { ...agent, aiConfigured: this.llm.configured };
  }
}
