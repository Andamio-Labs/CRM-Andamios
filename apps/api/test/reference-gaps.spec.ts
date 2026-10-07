import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTeam, createTestApp, type TestApp } from './support/test-app.js';

/** X-07 — Brechas vistas en el CRM de referencia (docs/GAP-REFERENCIA.md). */
describe('Brechas de la referencia', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Andamios Referencia');
  });
  afterAll(() => t.close());

  describe('Clientes', () => {
    it('origen, prioridad y tipo son datos propios del cliente', async () => {
      const c = (await team.owner.api.post('/api/v1/contacts', { name: 'ACME', source: 'feria', priority: 'critical', kind: 'company' }).expect(201)).body;
      expect(c).toMatchObject({ source: 'feria', priority: 'critical', kind: 'company' });
      await team.owner.api.post('/api/v1/contacts', { name: 'X', priority: 'urgente' }).expect(400);
    });

    it('al crear un cliente puede crearse su negocio en el embudo elegido', async () => {
      const pipeline = (await team.owner.api.get('/api/v1/pipelines').expect(200)).body[0];
      const c = (await team.seller.api.post('/api/v1/contacts', { name: 'Con negocio', phone: '3001110001', createDeal: { pipelineId: pipeline.id } }).expect(201)).body;
      const deals = (await t.owner.query(`SELECT title, stage_id, owner_id FROM deals WHERE contact_id = $1`, [c.id])).rows;
      expect(deals).toEqual([{ title: 'Con negocio', stage_id: pipeline.stages[0].id, owner_id: team.seller.userId }]);
    });

    it('"mis clientes" y la barra de estadísticas', async () => {
      await team.seller.api.post('/api/v1/contacts', { name: 'Del vendedor', phone: '3001110002', source: 'instagram' }).expect(201);
      const mine = (await team.seller.api.get('/api/v1/contacts?mine=true&limit=100').expect(200)).body.items;
      expect(mine.every((c: { ownerId: string }) => c.ownerId === team.seller.userId)).toBe(true);

      const stats = (await team.owner.api.get('/api/v1/contacts/stats').expect(200)).body;
      expect(stats.total).toBeGreaterThanOrEqual(3);
      expect(stats.withPhone).toBeGreaterThanOrEqual(2);
      expect(stats.topSource).toEqual(expect.objectContaining({ source: expect.any(String), count: expect.any(Number) }));
    });
  });

  describe('Embudo', () => {
    it('busca por nombre, teléfono del contacto y descripción, y filtra "mis leads"', async () => {
      const { api } = team.owner;
      const p = (await api.post('/api/v1/pipelines', { name: 'Búsqueda' }).expect(201)).body;
      const contact = (await api.post('/api/v1/contacts', { name: 'Óscar Peña', phone: '3157778899' }).expect(201)).body;
      await api.post('/api/v1/deals', { title: 'Andamio colgante', pipelineId: p.id, contactId: contact.id, description: 'Obra en Chapinero, 12 pisos' }).expect(201);
      await api.post('/api/v1/deals', { title: 'Del vendedor', pipelineId: p.id, ownerId: team.seller.userId }).expect(201);

      const titles = async (query: string) =>
        (await api.get(`/api/v1/pipelines/${p.id}/board?${query}`).expect(200)).body.stages.flatMap((s: { deals: { title: string }[] }) => s.deals.map((d) => d.title));
      expect(await titles('q=colgante')).toEqual(['Andamio colgante']);
      expect(await titles('q=oscar')).toEqual(['Andamio colgante']);
      expect(await titles('q=7778899')).toEqual(['Andamio colgante']);
      expect(await titles('q=chapinero')).toEqual(['Andamio colgante']);
      const sellerMine = (await team.seller.api.get(`/api/v1/pipelines/${p.id}/board?mine=true`).expect(200)).body;
      expect(sellerMine.stages.flatMap((s: { deals: { title: string }[] }) => s.deals.map((d) => d.title))).toEqual(['Del vendedor']);
    });

    it('la tarjeta trae contacto, teléfono, origen, responsable y fecha', async () => {
      const { api } = team.owner;
      const p = (await api.post('/api/v1/pipelines', { name: 'Tarjetas' }).expect(201)).body;
      const contact = (await api.post('/api/v1/contacts', { name: 'Ana Ruiz', phone: '3001234000' }).expect(201)).body;
      await api.post('/api/v1/deals', { title: 'Con datos', pipelineId: p.id, contactId: contact.id, source: 'whatsapp', ownerId: team.seller.userId }).expect(201);
      await api.post('/api/v1/deals', { title: 'Sin responsable', pipelineId: p.id, ownerId: null }).expect(201);
      const deals = (await api.get(`/api/v1/pipelines/${p.id}/board`).expect(200)).body.stages[0].deals;
      expect(deals[0]).toMatchObject({ title: 'Con datos', source: 'whatsapp', contact: { name: 'Ana Ruiz', phone: '+573001234000' }, owner: { name: expect.any(String) }, createdAt: expect.any(String) });
      expect(deals[1]).toMatchObject({ title: 'Sin responsable', owner: null, contact: null });
    });

    it('vista lista del mismo embudo, con los mismos filtros', async () => {
      const { api } = team.owner;
      const p = (await api.post('/api/v1/pipelines', { name: 'Lista', stages: [{ name: 'A' }, { name: 'B' }] }).expect(201)).body;
      await api.post('/api/v1/deals', { title: 'Uno', pipelineId: p.id }).expect(201);
      await api.post('/api/v1/deals', { title: 'Dos', pipelineId: p.id, stageId: p.stages[1].id }).expect(201);
      const list = (await api.get(`/api/v1/deals?pipelineId=${p.id}`).expect(200)).body;
      expect(list.items.map((d: { title: string; stage: { name: string } }) => [d.title, d.stage.name]).sort()).toEqual([['Dos', 'B'], ['Uno', 'A']]);
      expect((await api.get(`/api/v1/deals?pipelineId=${p.id}&q=dos`).expect(200)).body.items).toHaveLength(1);
    });
  });
});
