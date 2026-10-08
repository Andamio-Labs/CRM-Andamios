import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KnowledgeIndexer } from '../src/modules/ai/application/knowledge-indexer.js';
import { type FetchedPage, type PageFetcher, UnsafeUrlError } from '../src/modules/ai/infrastructure/page-fetcher.js';
import { PAGE_FETCHER } from '../src/shared/tokens.js';
import { makePdf } from './support/pdf.js';
import { APP_URL, createTeam, createTestApp, type TestApp } from './support/test-app.js';

/** E05-S02 — Base de conocimiento (FAQ y texto). La indexación vectorial llega con la IA. */
describe('Base de conocimiento (E05-S02)', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;

  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Conocimiento SAS');
  });
  afterAll(() => t.close());

  it('carga texto: queda troceado y esperando la IA para indexarse', async () => {
    const content = Array.from({ length: 30 }, (_, i) => `Párrafo ${i}: alquilamos andamios certificados por días, semanas o meses.`).join('\n\n');
    const source = (await team.owner.api.post('/api/v1/ai/knowledge', { kind: 'text', title: 'Quiénes somos', content }).expect(201)).body;
    expect(source).toMatchObject({ kind: 'text', title: 'Quiénes somos', status: 'waiting_ai' });
    expect(source.chunkCount).toBeGreaterThan(1);
    const { rows } = await t.owner.query(`SELECT ordinal, content FROM knowledge_chunks WHERE source_id = $1 ORDER BY ordinal`, [source.id]);
    expect(rows).toHaveLength(source.chunkCount);
    expect(rows[0].content).toContain('Párrafo 0');
  });

  it('carga FAQ: un fragmento por pregunta', async () => {
    const items = [{ question: '¿Hacen envíos?', answer: 'Sí, a toda Colombia.' }, { question: '¿Piden depósito?', answer: 'Sí, del 30 %.' }];
    const source = (await team.admin.api.post('/api/v1/ai/knowledge', { kind: 'faq', title: 'Preguntas frecuentes', items }).expect(201)).body;
    expect(source).toMatchObject({ kind: 'faq', chunkCount: 2 });
    expect((await team.owner.api.get(`/api/v1/ai/knowledge/${source.id}`).expect(200)).body.items).toEqual(items);
  });

  it('lista las fuentes con su estado; editar vuelve a trocear; borrar quita los fragmentos', async () => {
    const source = (await team.owner.api.post('/api/v1/ai/knowledge', { kind: 'text', title: 'Horarios', content: 'Lunes a viernes de 8 a 5.' }).expect(201)).body;
    const list = (await team.owner.api.get('/api/v1/ai/knowledge').expect(200)).body;
    expect(list.find((s: { id: string }) => s.id === source.id)).toMatchObject({ title: 'Horarios', status: 'waiting_ai', chunkCount: 1 });
    expect(list[0]).not.toHaveProperty('content');

    const long = Array.from({ length: 40 }, (_, i) => `Sede ${i}: abierta de lunes a sábado en horario extendido.`).join('\n\n');
    const updated = (await team.owner.api.put(`/api/v1/ai/knowledge/${source.id}`, { title: 'Horarios y sedes', content: long }).expect(200)).body;
    expect(updated.chunkCount).toBeGreaterThan(1);
    const count = async () => (await t.owner.query(`SELECT count(*)::int AS n FROM knowledge_chunks WHERE source_id = $1`, [source.id])).rows[0].n;
    expect(await count()).toBe(updated.chunkCount);

    await team.owner.api.del(`/api/v1/ai/knowledge/${source.id}`).expect(204);
    expect(await count()).toBe(0);
    await team.owner.api.get(`/api/v1/ai/knowledge/${source.id}`).expect(404);
  });

  it('valida tipo, contenido y tamaño', async () => {
    const post = (body: object) => team.owner.api.post('/api/v1/ai/knowledge', body);
    await post({ kind: 'pdf', title: 'x', content: 'x' }).expect(400);
    await post({ kind: 'text', title: 'x', content: '   ' }).expect(400);
    await post({ kind: 'text', title: 'x', content: 'x'.repeat(100_001) }).expect(400);
    await post({ kind: 'faq', title: 'x', items: [] }).expect(400);
    await post({ kind: 'faq', title: 'x', items: [{ question: '¿?', answer: '' }] }).expect(400);
  });

  it('el vendedor no gestiona la base; otra empresa no la ve', async () => {
    const source = (await team.owner.api.post('/api/v1/ai/knowledge', { kind: 'text', title: 'Privado', content: 'Precios internos.' }).expect(201)).body;
    await team.seller.api.get('/api/v1/ai/knowledge').expect(403);
    await team.seller.api.post('/api/v1/ai/knowledge', { kind: 'text', title: 'x', content: 'x' }).expect(403);
    const other = (await createTeam(t, 'Otra de conocimiento')).owner.api;
    expect((await other.get('/api/v1/ai/knowledge').expect(200)).body).toEqual([]);
    await other.get(`/api/v1/ai/knowledge/${source.id}`).expect(404);
    await other.del(`/api/v1/ai/knowledge/${source.id}`).expect(404);
  });
});

/** E05-S02 — Con un modelo de embeddings: indexación en pgvector, PDF y URL. */
describe('Indexación de la base de conocimiento (E05-S02)', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  const pages = new Map<string, FetchedPage | Error>();
  const fetcher: PageFetcher = async (url) => {
    const page = pages.get(url);
    if (!page) throw new Error('La página respondió 404');
    if (page instanceof Error) throw page;
    return page;
  };

  beforeAll(async () => {
    t = await createTestApp({ EMBEDDINGS_API: 'local' }, (builder) => builder.overrideProvider(PAGE_FETCHER).useValue(fetcher));
    team = await createTeam(t, 'Indexa SAS');
  });
  afterAll(() => t.close());

  const embedded = async (sourceId: string) =>
    (await t.owner.query(`SELECT count(*) FILTER (WHERE embedding IS NOT NULL)::int AS done, count(*)::int AS total FROM knowledge_chunks WHERE source_id = $1`, [sourceId])).rows[0];
  const upload = (pdf: Buffer, name = 'catalogo.pdf', title = 'Catálogo') =>
    team.owner.agent.post('/api/v1/ai/knowledge/pdf').set('Origin', APP_URL).field('title', title).attach('file', pdf, name);

  it('un texto queda indexado: cada fragmento con su vector', async () => {
    const source = (await team.owner.api.post('/api/v1/ai/knowledge', { kind: 'text', title: 'Precios', content: 'El andamio tubular cuesta $1.200.000 al mes.' }).expect(201)).body;
    const fresh = (await team.owner.api.get(`/api/v1/ai/knowledge/${source.id}`).expect(200)).body;
    expect(fresh.status).toBe('ready');
    expect(await embedded(source.id)).toEqual({ done: 1, total: 1 });
  });

  it('PDF: extrae el texto de todas las páginas y lo indexa', async () => {
    const res = (await upload(makePdf(['Alquiler de andamios certificados.', 'Entregas en Bogota y Medellin.'])).expect(201)).body;
    expect(res).toMatchObject({ kind: 'pdf', title: 'Catálogo', fileName: 'catalogo.pdf' });
    const detail = (await team.owner.api.get(`/api/v1/ai/knowledge/${res.id}`).expect(200)).body;
    expect(detail.status).toBe('ready');
    expect(detail.content).toContain('Alquiler de andamios certificados.');
    expect(detail.content).toContain('Entregas en Bogota y Medellin.');
  });

  it('PDF: rechaza lo que no es PDF y avisa si no tiene texto (escaneado)', async () => {
    expect((await upload(Buffer.from('hola'), 'falso.pdf').expect(400)).body.code).toBe('INVALID_PDF');
    expect((await upload(makePdf([]), 'escaneado.pdf').expect(422)).body.code).toBe('PDF_WITHOUT_TEXT');
  });

  it('URL: guarda el texto legible de la página y se puede volver a leer', async () => {
    pages.set('https://andamios.example/precios', { url: 'https://andamios.example/precios', contentType: 'text/html', body: '<title>Precios</title><nav>menú</nav><p>Tubular: $1.200.000</p>' });
    const source = (await team.owner.api.post('/api/v1/ai/knowledge', { kind: 'url', title: 'Web', url: 'https://andamios.example/precios' }).expect(201)).body;
    expect(source).toMatchObject({ kind: 'url', url: 'https://andamios.example/precios' });
    expect((await team.owner.api.get(`/api/v1/ai/knowledge/${source.id}`).expect(200)).body).toMatchObject({ content: 'Tubular: $1.200.000', status: 'ready' });

    pages.set('https://andamios.example/precios', { url: 'https://andamios.example/precios', contentType: 'text/html', body: '<p>Tubular: $1.300.000</p>' });
    await team.owner.api.post(`/api/v1/ai/knowledge/${source.id}/refresh`, {}).expect(200);
    expect((await team.owner.api.get(`/api/v1/ai/knowledge/${source.id}`).expect(200)).body.content).toBe('Tubular: $1.300.000');
  });

  it('URL: una dirección interna o que no responde no se guarda', async () => {
    pages.set('http://10.0.0.5/', new UnsafeUrlError('La dirección no es pública'));
    expect((await team.owner.api.post('/api/v1/ai/knowledge', { kind: 'url', title: 'x', url: 'http://10.0.0.5/' }).expect(422)).body.code).toBe('UNSAFE_URL');
    expect((await team.owner.api.post('/api/v1/ai/knowledge', { kind: 'url', title: 'x', url: 'https://no-existe.example/' }).expect(422)).body.code).toBe('URL_UNREACHABLE');
  });

  it('el barrido indexa lo que se cargó cuando no había modelo de embeddings', async () => {
    const before = await createTestApp();
    const owner = await createTeam(before, 'Sin modelo SAS');
    const source = (await owner.owner.api.post('/api/v1/ai/knowledge', { kind: 'text', title: 'Viejo', content: 'Cargado antes de la IA.' }).expect(201)).body;
    expect(source.status).toBe('waiting_ai');
    await before.close();

    await t.app.get(KnowledgeIndexer).sweep();
    const { rows } = await t.owner.query(`SELECT status FROM knowledge_sources WHERE id = $1`, [source.id]);
    expect(rows[0].status).toBe('ready');
    expect(await embedded(source.id)).toEqual({ done: 1, total: 1 });
  });
});
