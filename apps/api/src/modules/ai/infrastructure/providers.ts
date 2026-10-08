import type { Env } from '../../../config/env.js';
import { type EmbeddingProvider, HashEmbeddings, NotConfiguredEmbeddings, OpenAiCompatibleEmbeddings } from '../../../shared/ai/embeddings.js';
import { type LlmProvider, LocalLlm, NotConfiguredLlm, OpenAiCompatibleLlm } from '../../../shared/ai/llm.js';

/** El proveedor sale de la configuración: cambiar de Groq a DeepSeek es cambiar variables, no código. */
export function llmFromEnv(env: Env): LlmProvider {
  if (env.LLM_API === 'local') return new LocalLlm();
  if (env.LLM_API === 'openai') {
    return new OpenAiCompatibleLlm({ baseUrl: env.LLM_BASE_URL!, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL!, timeoutMs: env.LLM_TIMEOUT_MS });
  }
  return new NotConfiguredLlm();
}

export function embeddingsFromEnv(env: Env): EmbeddingProvider {
  if (env.EMBEDDINGS_API === 'local') return new HashEmbeddings();
  if (env.EMBEDDINGS_API === 'openai') {
    return new OpenAiCompatibleEmbeddings({ baseUrl: env.EMBEDDINGS_BASE_URL!, apiKey: env.EMBEDDINGS_API_KEY, model: env.EMBEDDINGS_MODEL! });
  }
  return new NotConfiguredEmbeddings();
}

/** pgvector recibe el vector como texto "[0.1,0.2,…]". */
export const toVector = (values: number[]) => `[${values.join(',')}]`;
