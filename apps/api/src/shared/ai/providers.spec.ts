import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIMENSIONS, HashEmbeddings, OpenAiCompatibleEmbeddings } from './embeddings.js';
import { AiProviderError, AiTimeoutError, LocalLlm, OpenAiCompatibleLlm } from './llm.js';

type Call = { url: string; init: RequestInit };
const fakeFetch = (respond: (call: Call) => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fn, calls };
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('OpenAiCompatibleLlm (Groq, DeepSeek, Ollama)', () => {
  const config = { baseUrl: 'https://api.groq.com/openai/v1/', apiKey: 'gsk_test', model: 'llama-3.3-70b-versatile', timeoutMs: 1000 };

  it('manda system + mensajes, pide JSON y lee texto y tokens', async () => {
    const http = fakeFetch(() => json({ model: 'llama-3.3-70b-versatile', choices: [{ message: { content: '{"reply":"Hola"}' } }], usage: { prompt_tokens: 120, completion_tokens: 9 } }));
    const llm = new OpenAiCompatibleLlm(config, http.fn);
    const res = await llm.complete({ system: 'Eres X', messages: [{ role: 'user', content: 'Hola' }], maxTokens: 300, json: true });

    expect(res).toEqual({ text: '{"reply":"Hola"}', model: 'llama-3.3-70b-versatile', inputTokens: 120, outputTokens: 9 });
    expect(http.calls[0]!.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((http.calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer gsk_test');
    expect(JSON.parse(http.calls[0]!.init.body as string)).toEqual({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: 'Eres X' }, { role: 'user', content: 'Hola' }],
      max_tokens: 300,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });
  });

  it('un error del proveedor no filtra la llave ni el cuerpo completo', async () => {
    const llm = new OpenAiCompatibleLlm(config, fakeFetch(() => json({ error: { message: 'Rate limit reached' } }, 429)).fn);
    const error = await llm.complete({ system: 's', messages: [] }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).status).toBe(429);
    expect((error as Error).message).not.toContain('gsk_test');
  });

  it('corta por tiempo: la respuesta no puede pasarse del presupuesto de latencia', async () => {
    const slow = fakeFetch(({ init }) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'TimeoutError')))));
    const llm = new OpenAiCompatibleLlm({ ...config, timeoutMs: 20 }, slow.fn);
    await expect(llm.complete({ system: 's', messages: [] })).rejects.toBeInstanceOf(AiTimeoutError);
  });
});

describe('OpenAiCompatibleEmbeddings (Ollama local)', () => {
  const vector = (seed: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === seed ? 1 : 0));

  it('pide los embeddings en lotes y respeta el orden', async () => {
    const http = fakeFetch(({ init }) => {
      const { input } = JSON.parse(init.body as string) as { input: string[] };
      return json({ data: input.map((_, i) => ({ index: input.length - 1 - i, embedding: vector(input.length - 1 - i) })).reverse() });
    });
    const embeddings = new OpenAiCompatibleEmbeddings({ baseUrl: 'http://ollama:11434/v1', model: 'bge-m3', batchSize: 2 }, http.fn);
    const out = await embeddings.embed(['a', 'b', 'c']);
    expect(http.calls).toHaveLength(2);
    expect(http.calls[0]!.url).toBe('http://ollama:11434/v1/embeddings');
    expect(out.map((v) => v.indexOf(1))).toEqual([0, 1, 0]);
  });

  it('rechaza un modelo con otra dimensión: la columna de pgvector es fija', async () => {
    const embeddings = new OpenAiCompatibleEmbeddings({ baseUrl: 'http://x/v1', model: 'm' }, fakeFetch(() => json({ data: [{ index: 0, embedding: [0.1, 0.2] }] })).fn);
    await expect(embeddings.embed(['a'])).rejects.toThrow(/1024/);
  });
});

describe('HashEmbeddings (desarrollo y tests, sin modelo)', () => {
  const cosine = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0);

  it('es determinista, normalizado y acerca textos con palabras en común', async () => {
    const e = new HashEmbeddings();
    const [a, a2, related, unrelated] = await e.embed(['Precio del andamio tubular', 'precio del ANDAMIO tubular', '¿Cuánto vale el andamio?', 'Horario de atención los sábados']);
    expect(a).toEqual(a2);
    expect(a).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(cosine(a!, a!)).toBeCloseTo(1, 5);
    expect(cosine(a!, related!)).toBeGreaterThan(cosine(a!, unrelated!));
  });
});

describe('LocalLlm (simulador de desarrollo)', () => {
  it('responde con el primer fragmento de conocimiento, o pasa a una persona si no hay', async () => {
    const llm = new LocalLlm();
    const withKnowledge = await llm.complete({ system: 'x\n<conocimiento>\n[1] El andamio cuesta $1.200.000.\n</conocimiento>', messages: [{ role: 'user', content: '¿precio?' }], json: true });
    expect(JSON.parse(withKnowledge.text)).toMatchObject({ reply: expect.stringContaining('$1.200.000'), handoff: false });
    const without = await llm.complete({ system: 'x', messages: [{ role: 'user', content: '¿precio?' }], json: true });
    expect(JSON.parse(without.text)).toMatchObject({ handoff: true });
  });

  it('se puede guionar para los tests', async () => {
    const llm = new LocalLlm();
    llm.respondWith('{"reply":"guion"}');
    expect((await llm.complete({ system: '', messages: [] })).text).toBe('{"reply":"guion"}');
    expect(llm.calls).toHaveLength(1);
  });
});
