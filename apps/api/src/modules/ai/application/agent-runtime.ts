import { Inject, Injectable } from '@nestjs/common';
import type { LlmMessage, LlmProvider } from '../../../shared/ai/llm.js';
import { LLM_PROVIDER } from '../../../shared/tokens.js';
import { parseAgentOutput } from '../domain/agent-output.js';
import { type AgentPromptConfig, buildAgentPrompt, FIXED_RULES } from '../domain/agent-prompt.js';
import { checkReply, detectInjection, redactSensitive } from '../domain/guardrails.js';
import type { Retrieved } from './knowledge-retriever.js';
import { KnowledgeRetriever } from './knowledge-retriever.js';

export type TurnOutcome = 'replied' | 'handoff' | 'blocked' | 'error';

export interface TurnInput {
  tenantId: string;
  companyName: string;
  agent: AgentPromptConfig;
  /** Conversación reciente, del más viejo al más nuevo. Los mensajes del cliente van como "user". */
  history: LlmMessage[];
  capture: { target: string; label: string }[];
}

export interface TurnResult {
  outcome: TurnOutcome;
  /** Lo que se le envía al cliente (puede ser el aviso de traspaso). */
  reply: string;
  handoff: boolean;
  fields: Record<string, unknown>;
  sources: { sourceId: string; title: string }[];
  violations: string[];
  prompt: { system: string; messages: LlmMessage[] };
  response: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error: string | null;
}

const HANDOFF_MESSAGE: Record<AgentPromptConfig['language'], string> = {
  'es-CO': 'Te paso con una persona del equipo, en un momento te responde.',
  'es-MX': 'Te paso con una persona del equipo, en un momento te responde.',
  'pt-BR': 'Vou te passar para uma pessoa da equipe, ela já te responde.',
};
const SAFE_REPLY: Record<AgentPromptConfig['language'], (company: string) => string> = {
  'es-CO': (c) => `Solo puedo ayudarte con temas de ${c}. ¿En qué te puedo ayudar?`,
  'es-MX': (c) => `Solo puedo ayudarte con temas de ${c}. ¿En qué te puedo ayudar?`,
  'pt-BR': (c) => `Só posso ajudar com assuntos da ${c}. Como posso ajudar?`,
};
export const handoffMessage = (language: AgentPromptConfig['language']) => HANDOFF_MESSAGE[language];

/**
 * E05-S03/S07 — Un turno del agente:
 * guardrail de entrada → búsqueda en la base → modelo (JSON) → guardrail de salida.
 * No toca la base salvo para buscar: quien lo llama decide qué se envía y qué se guarda.
 */
@Injectable()
export class AgentRuntime {
  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly retriever: KnowledgeRetriever,
  ) {}

  get configured() {
    return this.llm.configured;
  }

  async respond(input: TurnInput): Promise<TurnResult> {
    const started = Date.now();
    // Los datos sensibles del cliente nunca llegan al proveedor.
    const messages = input.history.map((m) => (m.role === 'user' ? { ...m, content: redactSensitive(m.content).text } : m));
    const lastUser = trailingUserText(messages);
    const base = {
      handoff: false, fields: {}, sources: [] as TurnResult['sources'], violations: [] as string[], response: null, model: null,
      inputTokens: 0, outputTokens: 0, error: null,
    };
    const finish = (result: Omit<TurnResult, 'latencyMs'>): TurnResult => ({ ...result, latencyMs: Date.now() - started });
    const handoff = (outcome: TurnOutcome, extra: Partial<TurnResult>, system: string) =>
      finish({ ...base, ...extra, outcome, handoff: true, reply: HANDOFF_MESSAGE[input.agent.language], prompt: { system, messages } });

    if (detectInjection(lastUser)) {
      return finish({ ...base, outcome: 'blocked', violations: ['prompt_injection'], reply: SAFE_REPLY[input.agent.language](input.companyName), prompt: { system: '', messages } });
    }

    let knowledge: Retrieved[] = [];
    try {
      knowledge = await this.retriever.search(input.tenantId, lastUser);
    } catch (error) {
      return handoff('error', { error: `Búsqueda: ${(error as Error).message}` }, '');
    }
    const sources = [...new Map(knowledge.map((k) => [k.sourceId, { sourceId: k.sourceId, title: k.title }])).values()];
    const system = buildAgentPrompt(input.agent, {
      companyName: input.companyName,
      knowledge: this.retriever.configured ? knowledge.map((k) => k.content) : undefined,
      capture: input.capture,
    });

    let completion;
    try {
      completion = await this.llm.complete({ system, messages, maxTokens: 600, json: true });
    } catch (error) {
      return handoff('error', { sources, error: (error as Error).message }, system);
    }
    const usage = { response: completion.text, model: completion.model, inputTokens: completion.inputTokens, outputTokens: completion.outputTokens, sources };
    const output = parseAgentOutput(completion.text);
    if (!output) return handoff('error', { ...usage, error: 'El modelo no respondió con el formato esperado' }, system);

    const allowedText = [input.agent.instructions, ...knowledge.map((k) => k.content), ...messages.filter((m) => m.role === 'user').map((m) => m.content)].join('\n');
    const checked = checkReply(output.reply, { rules: FIXED_RULES, allowedText });
    if (checked.violations.length) return handoff('blocked', { ...usage, violations: checked.violations, fields: output.fields }, system);
    if (output.handoff) {
      return finish({ ...base, ...usage, outcome: 'handoff', handoff: true, fields: output.fields, reply: checked.reply || HANDOFF_MESSAGE[input.agent.language], prompt: { system, messages } });
    }
    return finish({ ...base, ...usage, outcome: 'replied', reply: checked.reply, fields: output.fields, prompt: { system, messages } });
  }
}

/** Los últimos mensajes seguidos del cliente: si mandó tres, la pregunta son los tres. */
function trailingUserText(messages: LlmMessage[]): string {
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0 && messages[i]!.role === 'user'; i--) out.unshift(messages[i]!.content);
  return out.join('\n');
}
