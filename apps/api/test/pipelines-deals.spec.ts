import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTeam, createTestApp, registerAndLogin, type TestApp } from './support/test-app.js';

/** E03-S01 embudos/etapas, E03-S03 ficha de negocio, E03-S02 movimiento, E03-S04 cierre. */
describe('Embudos y negocios', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Clínica Dental');
  });
  afterAll(() => t.close());

  const defaultPipeline = async () => (await team.owner.api.get('/api/v1/pipelines').expect(200)).body[0];

  describe('Embudos y etapas (E03-S01)', () => {
    it('cada empresa nueva arranca con un embudo de ventas y motivos de cierre', async () => {
      const pipeline = await defaultPipeline();
      expect(pipeline.name).toBe('Ventas');
      expect(pipeline.stages.map((s: { name: string }) => s.name)).toEqual(['Nuevo', 'Contactado', 'Propuesta', 'Negociación']);
      const reasons = (await team.owner.api.get('/api/v1/close-reasons').expect(200)).body;
      expect(reasons.some((r: { outcome: string }) => r.outcome === 'won')).toBe(true);
      expect(reasons.some((r: { outcome: string }) => r.outcome === 'lost')).toBe(true);
    });

    it('varios embudos; etapas que se crean, renombran, colorean y reordenan', async () => {
      const { api } = team.admin;
      const p = (await api.post('/api/v1/pipelines', { name: 'Posventa', stages: [{ name: 'A' }, { name: 'B', color: '#22c55e' }] }).expect(201)).body;
      const c = (await api.post(`/api/v1/pipelines/${p.id}/stages`, { name: 'C', color: '#ef4444' }).expect(201)).body;
      await api.patch(`/api/v1/stages/${c.id}`, { name: 'Cerrado', color: '#000000' }).expect(200);
      await api.patch(`/api/v1/stages/${c.id}`, { color: 'rojo' }).expect(400);

      const ids = p.stages.map((s: { id: string }) => s.id);
      await api.put(`/api/v1/pipelines/${p.id}/stage-order`, { stageIds: [c.id, ids[1], ids[0]] }).expect(204);
      await api.put(`/api/v1/pipelines/${p.id}/stage-order`, { stageIds: [c.id, ids[1]] }).expect(400); // falta una

      const list = (await api.get('/api/v1/pipelines').expect(200)).body;
      expect(list.find((x: { id: string }) => x.id === p.id).stages.map((s: { name: string }) => s.name)).toEqual(['Cerrado', 'B', 'A']);
    });

    it('no se borra una etapa con negocios; sí una vacía', async () => {
      const { api } = team.owner;
      const p = (await api.post('/api/v1/pipelines', { name: 'Borrables', stages: [{ name: 'Con negocio' }, { name: 'Vacía' }, { name: 'Otra' }] }).expect(201)).body;
      await api.post('/api/v1/deals', { title: 'Bloquea', pipelineId: p.id, stageId: p.stages[0].id }).expect(201);
      const res = await api.del(`/api/v1/stages/${p.stages[0].id}`).expect(409);
      expect(res.body.code).toBe('STAGE_HAS_DEALS');
      await api.del(`/api/v1/stages/${p.stages[1].id}`).expect(204);
    });

    it('el vendedor no configura embudos', async () => {
      await team.seller.api.post('/api/v1/pipelines', { name: 'X' }).expect(403);
    });
  });

  describe('Negocios (E03-S03)', () => {
    it('ficha completa vinculada a contacto y organización; moneda por defecto del tenant', async () => {
      const { api } = team.owner;
      const pipeline = await defaultPipeline();
      const contact = (await api.post('/api/v1/contacts', { name: 'Paciente' }).expect(201)).body;
      const company = (await api.post('/api/v1/companies', { name: 'EPS Sura' }).expect(201)).body;
      const deal = (await api.post('/api/v1/deals', {
        title: 'Ortodoncia', pipelineId: pipeline.id, value: 4500000, probability: 60, expectedCloseDate: '2026-12-15',
        ownerId: team.seller.userId, source: 'whatsapp', contactId: contact.id, companyId: company.id,
      }).expect(201)).body;
      expect(deal).toMatchObject({ value: 4500000, currency: 'COP', probability: 60, stageId: pipeline.stages[0].id, status: 'open', ownerId: team.seller.userId });

      const read = (await api.get(`/api/v1/deals/${deal.id}`).expect(200)).body;
      expect(read.contact).toMatchObject({ id: contact.id, name: 'Paciente' });
      expect(read.company).toMatchObject({ id: company.id, name: 'EPS Sura' });
    });

    it.each([
      ['probabilidad > 100', { probability: 101 }],
      ['valor negativo', { value: -5 }],
      ['moneda inválida', { currency: 'PESOS' }],
      ['fecha inválida', { expectedCloseDate: '15/12/2026' }],
    ])('rechaza con 400: %s', async (_, body) => {
      const pipeline = await defaultPipeline();
      await team.owner.api.post('/api/v1/deals', { title: 'X', pipelineId: pipeline.id, ...body }).expect(400);
    });

    it('no acepta etapa de otro embudo ni contacto de otra empresa', async () => {
      const { api } = team.owner;
      const pipeline = await defaultPipeline();
      const other = (await api.post('/api/v1/pipelines', { name: 'Otro' }).expect(201)).body;
      await api.post('/api/v1/deals', { title: 'X', pipelineId: pipeline.id, stageId: other.stages[0].id }).expect(400);

      const foreign = as((await registerAndLogin(t)).agent);
      const foreignContact = (await foreign.post('/api/v1/contacts', { name: 'Ajeno' }).expect(201)).body;
      await api.post('/api/v1/deals', { title: 'X', pipelineId: pipeline.id, contactId: foreignContact.id }).expect(404);
    });
  });

  describe('Kanban: mover negocios (E03-S02)', () => {
    it('mover cambia la etapa, respeta el orden y queda en el historial', async () => {
      const { api } = team.owner;
      const p = (await api.post('/api/v1/pipelines', { name: 'Kanban', stages: [{ name: 'Uno' }, { name: 'Dos' }] }).expect(201)).body;
      const [s1, s2] = p.stages;
      const mk = async (title: string) => (await api.post('/api/v1/deals', { title, pipelineId: p.id }).expect(201)).body;
      const a = await mk('A');
      const b = await mk('B');
      const c = await mk('C');

      await api.post(`/api/v1/deals/${c.id}/move`, { stageId: s2.id, afterDealId: null }).expect(200);
      await api.post(`/api/v1/deals/${a.id}/move`, { stageId: s2.id, afterDealId: c.id }).expect(200);
      await api.post(`/api/v1/deals/${b.id}/move`, { stageId: s2.id, afterDealId: c.id }).expect(200); // entre C y A

      const board = (await api.get(`/api/v1/pipelines/${p.id}/board`).expect(200)).body;
      expect(board.stages.find((s: { id: string }) => s.id === s1.id).deals).toEqual([]);
      expect(board.stages.find((s: { id: string }) => s.id === s2.id).deals.map((d: { title: string }) => d.title)).toEqual(['C', 'B', 'A']);

      const events = (await api.get(`/api/v1/deals/${a.id}/events`).expect(200)).body;
      expect(events.map((e: { type: string }) => e.type)).toEqual(['created', 'stage_changed']);
      expect(events[1].data).toMatchObject({ from: s1.id, to: s2.id });
    });

    it('no se puede mover a una etapa de otro embudo ni detrás de un negocio de otra columna', async () => {
      const { api } = team.owner;
      const p = (await api.post('/api/v1/pipelines', { name: 'Mov', stages: [{ name: 'X' }, { name: 'Y' }] }).expect(201)).body;
      const other = await defaultPipeline();
      const d = (await api.post('/api/v1/deals', { title: 'D', pipelineId: p.id }).expect(201)).body;
      const e = (await api.post('/api/v1/deals', { title: 'E', pipelineId: p.id }).expect(201)).body;
      await api.post(`/api/v1/deals/${d.id}/move`, { stageId: other.stages[0].id }).expect(400);
      await api.post(`/api/v1/deals/${d.id}/move`, { stageId: p.stages[1].id, afterDealId: e.id }).expect(400);
    });

    it('con la regla activa el vendedor solo ve y mueve sus negocios', async () => {
      const { api } = team.owner;
      const p = (await api.post('/api/v1/pipelines', { name: 'Visibilidad' }).expect(201)).body;
      const mine = (await api.post('/api/v1/deals', { title: 'Del vendedor', pipelineId: p.id, ownerId: team.seller.userId }).expect(201)).body;
      const theirs = (await api.post('/api/v1/deals', { title: 'Del dueño', pipelineId: p.id }).expect(201)).body;
      await api.patch('/api/v1/tenant/settings', { sellersSeeOnlyAssigned: true }).expect(200);

      const board = (await team.seller.api.get(`/api/v1/pipelines/${p.id}/board`).expect(200)).body;
      expect(board.stages.flatMap((s: { deals: { title: string }[] }) => s.deals.map((d) => d.title))).toEqual(['Del vendedor']);
      await team.seller.api.post(`/api/v1/deals/${theirs.id}/move`, { stageId: p.stages[1].id }).expect(404);
      await team.seller.api.post(`/api/v1/deals/${mine.id}/move`, { stageId: p.stages[1].id }).expect(200);
      await api.patch('/api/v1/tenant/settings', { sellersSeeOnlyAssigned: false }).expect(200);
    });
  });

  describe('Cierre ganado/perdido (E03-S04)', () => {
    it('exige motivo válido, queda en el historial y sale del tablero; se puede reabrir', async () => {
      const { api } = team.owner;
      const pipeline = await defaultPipeline();
      const reasons = (await api.get('/api/v1/close-reasons').expect(200)).body;
      const lost = reasons.find((r: { outcome: string }) => r.outcome === 'lost');
      const won = reasons.find((r: { outcome: string }) => r.outcome === 'won');
      const deal = (await api.post('/api/v1/deals', { title: 'Se pierde', pipelineId: pipeline.id }).expect(201)).body;

      await api.post(`/api/v1/deals/${deal.id}/close`, { outcome: 'lost' }).expect(400); // sin motivo
      await api.post(`/api/v1/deals/${deal.id}/close`, { outcome: 'lost', reasonId: won.id }).expect(400); // motivo de ganado
      const closed = (await api.post(`/api/v1/deals/${deal.id}/close`, { outcome: 'lost', reasonId: lost.id, note: 'Muy caro' }).expect(200)).body;
      expect(closed).toMatchObject({ status: 'lost', closeReasonId: lost.id });
      expect(closed.closedAt).toBeTruthy();
      await api.post(`/api/v1/deals/${deal.id}/close`, { outcome: 'won', reasonId: won.id }).expect(409); // ya cerrado

      const board = (await api.get(`/api/v1/pipelines/${pipeline.id}/board`).expect(200)).body;
      expect(board.stages.flatMap((s: { deals: { id: string }[] }) => s.deals.map((d) => d.id))).not.toContain(deal.id);

      await api.post(`/api/v1/deals/${deal.id}/reopen`).expect(200);
      const events = (await api.get(`/api/v1/deals/${deal.id}/events`).expect(200)).body;
      expect(events.map((e: { type: string }) => e.type)).toEqual(['created', 'lost', 'reopened']);
      expect(events[1].data).toMatchObject({ reasonId: lost.id, reason: lost.label, note: 'Muy caro' });
    });

    it('los motivos son configurables y uno inactivo no se puede usar', async () => {
      const { api } = team.admin;
      const r = (await api.post('/api/v1/close-reasons', { outcome: 'lost', label: 'Se mudó de ciudad' }).expect(201)).body;
      await api.patch(`/api/v1/close-reasons/${r.id}`, { active: false }).expect(200);
      const pipeline = await defaultPipeline();
      const deal = (await api.post('/api/v1/deals', { title: 'X', pipelineId: pipeline.id }).expect(201)).body;
      await api.post(`/api/v1/deals/${deal.id}/close`, { outcome: 'lost', reasonId: r.id }).expect(400);
      await team.seller.api.post('/api/v1/close-reasons', { outcome: 'won', label: 'X' }).expect(403);
    });
  });
});
