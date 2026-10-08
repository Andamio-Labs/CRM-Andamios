/**
 * Puerto del modelo de lenguaje. El proveedor real (Groq, DeepSeek u otro) se elige más adelante:
 * mientras tanto corre `NotConfiguredLlm` y todo lo que depende de la IA lo muestra como pendiente.
 */
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  maxTokens?: number;
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
