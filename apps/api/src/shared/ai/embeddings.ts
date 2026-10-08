/**
 * Puerto de embeddings para la búsqueda de la base de conocimiento (E05-S02).
 * La columna `knowledge_chunks.embedding` es vector(1024): cambiar a un modelo de otra dimensión
 * exige una migración y reindexar todo.
 */
export const EMBEDDING_DIMENSIONS = 1024;

export interface EmbeddingProvider {
  readonly configured: boolean;
  embed(texts: string[]): Promise<number[][]>;
}

export class NotConfiguredEmbeddings implements EmbeddingProvider {
  readonly configured = false;
  embed(): Promise<number[][]> {
    return Promise.reject(new Error('No hay un modelo de embeddings configurado'));
  }
}

/** `POST {baseUrl}/embeddings` con el formato de OpenAI (Ollama, llama.cpp, TEI…). */
export class OpenAiCompatibleEmbeddings implements EmbeddingProvider {
  readonly configured = true;

  constructor(
    private readonly config: { baseUrl: string; apiKey?: string; model: string; batchSize?: number; timeoutMs?: number },
    private readonly http: typeof fetch = fetch,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const size = this.config.batchSize ?? 32;
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += size) out.push(...(await this.batch(texts.slice(i, i + size))));
    return out;
  }

  private async batch(input: string[]): Promise<number[][]> {
    const { baseUrl, apiKey, model, timeoutMs = 30_000 } = this.config;
    const res = await this.http(`${baseUrl.replace(/\/+$/, '')}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`El modelo de embeddings respondió ${res.status}`);
    const { data } = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    const sorted = [...data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    const wrong = sorted.find((v) => v.length !== EMBEDDING_DIMENSIONS);
    if (wrong) throw new Error(`El modelo devuelve vectores de ${wrong.length} dimensiones; la base espera ${EMBEDDING_DIMENSIONS}`);
    return sorted;
  }
}

const STOPWORDS = new Set(['del', 'los', 'las', 'que', 'por', 'para', 'con', 'una', 'uno', 'como', 'the', 'and']);

/**
 * Embeddings por hashing de palabras (desarrollo y tests, EMBEDDINGS_API=local). No entiende sinónimos:
 * acerca textos que comparten palabras. Suficiente para probar el flujo sin un modelo.
 */
export class HashEmbeddings implements EmbeddingProvider {
  readonly configured = true;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      const words = text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().match(/\p{L}{3,}|\d+/gu) ?? [];
      for (const word of words) {
        if (STOPWORDS.has(word)) continue;
        let hash = 2166136261;
        for (const char of word) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
        vector[hash % EMBEDDING_DIMENSIONS]! += 1;
      }
      const norm = Math.hypot(...vector) || 1;
      return vector.map((v) => v / norm);
    });
  }
}
