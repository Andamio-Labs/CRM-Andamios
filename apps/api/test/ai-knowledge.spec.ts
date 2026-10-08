import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTeam, createTestApp, type TestApp } from './support/test-app.js';

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
