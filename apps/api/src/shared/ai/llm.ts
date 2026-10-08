/**
 * Puerto del modelo de lenguaje. Un solo adaptador (`OpenAiCompatibleLlm`) sirve para Groq, DeepSeek
 * u Ollama: cambiar de proveedor es cambiar LLM_BASE_URL, LLM_MODEL y LLM_API_KEY. Sin proveedor corre
 * `NotConfiguredLlm` y todo lo que depende de la IA se muestra como pendiente.
 */
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  maxTokens?: number;
  /** Pide un objeto JSON (response_format json_object). */
  json?: boolean;
}

export interface LlmResponse {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmProvider {
  readonly configured: boolean;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super('No hay un proveedor de IA configurado');
  }
}

export class NotConfiguredLlm implements LlmProvider {
  readonly configured = false;
  complete(): Promise<LlmResponse> {
    return Promise.reject(new AiNotConfiguredError());
  }
}

export class AiTimeoutError extends Error {
  constructor(ms: number) {
    super(`El proveedor de IA no respondió en ${ms} ms`);
  }
}

export class AiProviderError extends Error {
  constructor(readonly status: number, detail: string) {
    super(`El proveedor de IA respondió ${status}: ${detail.slice(0, 200)}`);
  }
}

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
}

/** Llama a `POST {baseUrl}/chat/completions` con el formato de OpenAI. */
export class OpenAiCompatibleLlm implements LlmProvider {
  readonly configured = true;

  constructor(private readonly config: OpenAiCompatibleConfig, private readonly http: typeof fetch = fetch) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const { baseUrl, apiKey, model, timeoutMs } = this.config;
    let res: Response;
    try {
      res = await this.http(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: request.system }, ...request.messages],
          max_tokens: request.maxTokens ?? 500,
          temperature: 0.2,
          ...(request.json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new AiTimeoutError(timeoutMs);
      throw error;
    }
    const body = (await res.json().catch(() => ({}))) as {
      model?: string; choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };
    if (!res.ok) throw new AiProviderError(res.status, body.error?.message ?? res.statusText);
    return {
      text: body.choices?.[0]?.message?.content ?? '',
      model: body.model ?? model,
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
    };
  }
}

/**
 * Simulador para desarrollo y tests (LLM_API=local; prohibido en producción). Sin guion, responde con
 * el primer fragmento de conocimiento del prompt o pide pasar con una persona si no hay ninguno.
 */
export class LocalLlm implements LlmProvider {
  readonly configured = true;
  readonly calls: LlmRequest[] = [];
  private script: string[] = [];

  respondWith(...texts: string[]) {
    this.script.push(...texts);
  }

  reset() {
    this.calls.length = 0;
    this.script = [];
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request);
    const text = this.script.shift() ?? this.answer(request.system);
    const input = request.system.length + request.messages.reduce((n, m) => n + m.content.length, 0);
    return { text, model: 'local', inputTokens: Math.ceil(input / 4), outputTokens: Math.ceil(text.length / 4) };
  }

  private answer(system: string) {
    const first = /<conocimiento>\n\[1\] ([\s\S]*?)(?:\n\[2\]|\n<\/conocimiento>)/.exec(system)?.[1]?.trim();
    return JSON.stringify(first
      ? { reply: `Según nuestra información: ${first.slice(0, 600)}`, handoff: false, fields: {} }
      : { reply: 'Te paso con una persona del equipo para ayudarte mejor.', handoff: true, fields: {} });
  }
}
