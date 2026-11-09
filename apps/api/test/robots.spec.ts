import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RobotsService } from '../src/modules/automation/robots.service.js';
import { createTeam, createTestApp, type TestApp } from './support/test-app.js';
import { connectChannel, conversationOf, inboundText, newPhoneId, sendWebhook } from './support/whatsapp.js';

let n = 0;
const phone = () => `5736${String(Date.now()).slice(-6)}${String(n++).padStart(2, '0')}`;

interface Stage { id: string; name: string }

/** E07-S04 — Robots por etapa: cuando → si → hacer. */
describe('Robots por etapa (E07-S04)', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  let pipelineId: string;
  let stages: Stage[];
  let pnid: string;
  const robots = () => t.app.get(RobotsService);
  const robot = (body: object) => team.admin.api.post('/api/v1/automation/robots', { pipelineId, ...body });
  const newDeal = async (title: string, extra: object = {}) =>
    (await team.owner.api.post('/api/v1/deals', { title, pipelineId, ownerId: team.seller.userId, ...extra }).expect(201)).body as { id: string };
  const tasksOf = async (dealId: string) => (await t.owner.query(`SELECT title, assignee_id FROM tasks WHERE deal_id = $1`, [dealId])).rows;
  const bell = async (who: typeof team.seller) => (await who.api.get('/api/v1/notifications').expect(200)).body.items as { type: string; title: string }[];

  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Robots SAS');
    const pipeline = (await team.owner.api.get('/api/v1/pipelines').expect(200)).body[0];
    pipelineId = pipeline.id;
    stages = pipeline.stages;
    pnid = newPhoneId();
    await connectChannel(team.owner.api, pnid).expect(201);
  });
  afterAll(() => t.close());

  it('valida la configuración y solo propietario y admins la gestionan', async () => {
    await robot({ stageId: stages[0]!.id, trigger: { type: 'won' }, action: { type: 'notify', to: 'owner' } }).expect(400);
    await robot({ stageId: null, trigger: { type: 'enter' }, action: { type: 'notify', to: 'owner' } }).expect(400);
    await robot({ stageId: stages[0]!.id, trigger: { type: 'enter' }, action: { type: 'move', stageId: stages[0]!.id } }).expect(400);
    await robot({ stageId: stages[0]!.id, trigger: { type: 'enter' }, action: { type: 'assign', userId: 'ajeno' } }).expect(400);
    await robot({ stageId: stages[0]!.id, trigger: { type: 'stale', days: 0 }, action: { type: 'notify', to: 'owner' } }).expect(400);
    await team.seller.api.post('/api/v1/automation/robots', { pipelineId, stageId: stages[0]!.id, trigger: { type: 'enter' }, action: { type: 'notify', to: 'owner' } }).expect(403);
  });

  it('al entrar a una etapa crea la tarea, una sola vez por entrada', async () => {
    const created = (await robot({ stageId: stages[1]!.id, trigger: { type: 'enter' }, action: { type: 'task', title: 'Enviar cotización', dueHours: 24 } }).expect(201)).body;
    expect(created).toMatchObject({ enabled: true, condition: {} });
    const deal = await newDeal('Andamio para fachada');
    await team.owner.api.post(`/api/v1/deals/${deal.id}/move`, { stageId: stages[1]!.id }).expect(200);
    expect(await tasksOf(deal.id)).toEqual([{ title: 'Enviar cotización', assignee_id: team.seller.userId }]);
    // Moverse dentro de la misma etapa no es una entrada nueva.
    await team.owner.api.post(`/api/v1/deals/${deal.id}/move`, { stageId: stages[1]!.id, afterDealId: null }).expect(200);
    expect(await tasksOf(deal.id)).toHaveLength(1);
    await team.admin.api.patch(`/api/v1/automation/robots/${created.id}`, { enabled: false }).expect(200);
  });

  it('negocio estancado X días: avisa al responsable una sola vez, aunque el barrido corra dos veces', async () => {
    await robot({ stageId: stages[0]!.id, trigger: { type: 'stale', days: 3 }, action: { type: 'notify', to: 'owner' } }).expect(201);
    const deal = await newDeal('Estancado');
    await t.owner.query(`UPDATE deals SET stage_entered_at = now() - interval '4 days' WHERE id = $1`, [deal.id]);
    await robots().sweep();
    await robots().sweep();
    const avisos = (await bell(team.seller)).filter((x) => x.type === 'robot' && x.title.startsWith('Estancado: Lleva 3 días en'));
    expect(avisos).toHaveLength(1);
  });

  it('cliente que no responde en X horas: mueve el negocio de etapa (y no reacciona a sus propios movimientos)', async () => {
    await robot({ stageId: stages[0]!.id, trigger: { type: 'no_reply', hours: 24 }, action: { type: 'move', stageId: stages[2]!.id } }).expect(201);
    // Un robot de "al entrar" en la etapa destino no corre por un movimiento de robot.
    await robot({ stageId: stages[2]!.id, trigger: { type: 'enter' }, action: { type: 'task', title: 'No debería crearse', dueHours: 1 } }).expect(201);
    const from = phone();
    await sendWebhook(t, inboundText(pnid, from, 'Hola, ¿precio?')).expect(200);
    const conv = await conversationOf(team.owner.api, `+${from}`);
    await team.owner.api.post(`/api/v1/conversations/${conv.id}/messages`, { type: 'text', text: 'Te cuesta 2 millones, ¿te sirve?' }).expect(202);
    await t.owner.query(`UPDATE messages SET created_at = created_at - interval '30 hours' WHERE conversation_id = $1`, [conv.id]);
    const dealId = (await t.owner.query(`SELECT id FROM deals WHERE contact_id = $1`, [conv.contact.id])).rows[0].id;

    await robots().sweep();
    const { rows: [moved] } = await t.owner.query(`SELECT stage_id FROM deals WHERE id = $1`, [dealId]);
    expect(moved.stage_id).toBe(stages[2]!.id);
    expect(await tasksOf(dealId)).toEqual([]);
    const events = (await team.owner.api.get(`/api/v1/deals/${dealId}/events`).expect(200)).body;
    expect(events.at(-1)).toMatchObject({ type: 'stage_changed', actorId: null, data: { to: stages[2]!.id } });
  });

  it('el cliente sí respondió: no hace nada', async () => {
    const from = phone();
    await sendWebhook(t, inboundText(pnid, from, 'Hola')).expect(200);
    const conv = await conversationOf(team.owner.api, `+${from}`);
    await team.owner.api.post(`/api/v1/conversations/${conv.id}/messages`, { type: 'text', text: '¿Qué necesitas?' }).expect(202);
    await t.owner.query(`UPDATE messages SET created_at = created_at - interval '30 hours' WHERE conversation_id = $1`, [conv.id]);
    await sendWebhook(t, inboundText(pnid, from, 'Un andamio de 10 metros')).expect(200);
    const dealId = (await t.owner.query(`SELECT id FROM deals WHERE contact_id = $1`, [conv.contact.id])).rows[0].id;
    await robots().sweep();
    expect((await t.owner.query(`SELECT stage_id FROM deals WHERE id = $1`, [dealId])).rows[0].stage_id).toBe(stages[0]!.id);
  });

  it('al ganar avisa a los admins; la condición "valor mínimo" se respeta', async () => {
    await robot({ stageId: null, trigger: { type: 'won' }, condition: { minValue: 1_000_000 }, action: { type: 'notify', to: 'admins' } }).expect(201);
    const won = (await team.owner.api.get('/api/v1/close-reasons').expect(200)).body.find((r: { outcome: string }) => r.outcome === 'won');
    const big = await newDeal('Contrato grande', { value: 5_000_000 });
    const small = await newDeal('Contrato chico', { value: 200_000 });
    for (const deal of [big, small]) await team.owner.api.post(`/api/v1/deals/${deal.id}/close`, { outcome: 'won', reasonId: won.id }).expect(200);

    const titles = (await bell(team.admin)).filter((x) => x.type === 'robot').map((x) => x.title);
    expect(titles).toContain('Contrato grande: Negocio ganado');
    expect(titles).not.toContain('Contrato chico: Negocio ganado');
    const runs = (await team.admin.api.get('/api/v1/automation/robots/runs').expect(200)).body;
    expect(runs.find((r: { dealTitle: string }) => r.dealTitle === 'Contrato chico')).toMatchObject({ status: 'skipped' });
  });

  it('otra empresa no ve los robots', async () => {
    const other = await createTeam(t, 'Otra de robots');
    expect((await other.owner.api.get('/api/v1/automation/robots').expect(200)).body).toEqual([]);
    const mine = (await team.admin.api.get('/api/v1/automation/robots').expect(200)).body[0];
    await other.owner.api.del(`/api/v1/automation/robots/${mine.id}`).expect(404);
  });
});
