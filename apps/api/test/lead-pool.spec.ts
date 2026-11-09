import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTeam, createTestApp, type TestApp } from './support/test-app.js';
import { connectChannel, conversationOf, inboundText, newPhoneId, sendWebhook } from './support/whatsapp.js';

let n = 0;
const phone = () => `5735${String(Date.now()).slice(-6)}${String(n++).padStart(2, '0')}`;

/** E03-S08 — Pool compartido de leads: el primer vendedor que lo toma se queda con él. */
describe('Pool compartido de leads (E03-S08)', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  let pnid: string;

  /** Llega un lead nuevo por WhatsApp; devuelve su negocio (sin dueño) y el teléfono. */
  async function newLead(text = 'Hola, ¿alquilan andamios?') {
    const from = phone();
    await sendWebhook(t, inboundText(pnid, from, text)).expect(200);
    const { rows } = await t.owner.query(
      `SELECT d.id, d.owner_id FROM deals d JOIN contacts c ON c.id = d.contact_id WHERE c.phone = $1`, [`+${from}`],
    );
    return { dealId: rows[0].id as string, ownerId: rows[0].owner_id as string | null, phone: `+${from}` };
  }

  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Pool SAS');
    pnid = newPhoneId();
    await connectChannel(team.owner.api, pnid).expect(201);
    // El admin pasa a vendedor: dos vendedores que compiten por el mismo lead.
    const members = (await team.owner.api.get('/api/v1/members').expect(200)).body as { id: string; userId: string }[];
    await team.owner.api.patch(`/api/v1/members/${members.find((m) => m.userId === team.admin.userId)!.id}`, { role: 'member' }).expect(200);
    await team.owner.api.patch('/api/v1/tenant/settings', { sellersSeeOnlyAssigned: true, leadPool: true }).expect(200);
    await team.owner.api.put('/api/v1/automation/rules/new_lead', { enabled: true, config: {} }).expect(200);
  });
  afterAll(() => t.close());

  it('con el pool activo, el lead no se reparte: queda sin dueño, a la vista de los vendedores, y se les avisa', async () => {
    const lead = await newLead();
    expect(lead.ownerId).toBeNull();
    const runs = (await team.owner.api.get('/api/v1/automation/runs').expect(200)).body;
    expect(runs[0]).toMatchObject({ rule: 'new_lead', status: 'skipped', detail: expect.stringMatching(/pool/i) });

    for (const seller of [team.seller, team.admin]) {
      await seller.api.get(`/api/v1/deals/${lead.dealId}`).expect(200);
      expect(await conversationOf(seller.api, lead.phone)).toBeTruthy();
      const bell = (await seller.api.get('/api/v1/notifications').expect(200)).body.items;
      expect(bell.some((x: { type: string; link: string }) => x.type === 'lead_pool' && x.link === '/deals?pool=1')).toBe(true);
    }
    expect(t.mailer.sent.some((m) => m.subject.startsWith('Nuevo lead en el pool'))).toBe(false);

    const pipeline = (await team.seller.api.get('/api/v1/pipelines').expect(200)).body[0];
    const board = (await team.seller.api.get(`/api/v1/pipelines/${pipeline.id}/board?pool=true`).expect(200)).body;
    expect(board.stages.flatMap((s: { deals: { id: string }[] }) => s.deals).map((d: { id: string }) => d.id)).toContain(lead.dealId);
  });

  it('el primero que lo toma se queda con el negocio, el cliente y la conversación; el resto deja de verlo', async () => {
    const lead = await newLead();
    const claimed = (await team.seller.api.post(`/api/v1/deals/${lead.dealId}/claim`).expect(200)).body;
    expect(claimed.ownerId).toBe(team.seller.userId);
    const { rows: [state] } = await t.owner.query(
      `SELECT c.owner_id AS contact_owner, cv.assigned_to FROM deals d JOIN contacts c ON c.id = d.contact_id
       JOIN conversations cv ON cv.contact_id = c.id WHERE d.id = $1`, [lead.dealId],
    );
    expect(state).toEqual({ contact_owner: team.seller.userId, assigned_to: team.seller.userId });

    const late = await team.admin.api.post(`/api/v1/deals/${lead.dealId}/claim`).expect(404);
    expect(late.body.code).not.toBe('LEAD_ALREADY_TAKEN'); // ya ni lo ve
    await team.admin.api.get(`/api/v1/deals/${lead.dealId}`).expect(404);
    expect(await conversationOf(team.admin.api, lead.phone)).toBeUndefined();
  });

  it('dos vendedores al mismo tiempo: solo uno se lo queda', async () => {
    const lead = await newLead();
    const results = await Promise.all([team.seller, team.admin].map((s) => s.api.post(`/api/v1/deals/${lead.dealId}/claim`)));
    // El que pierde recibe 409 si chocaron en el UPDATE, o 404 si llegó cuando el lead ya no estaba en el pool.
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect([404, 409]).toContain(results.find((r) => r.status !== 200)!.status);
    const winner = results.find((r) => r.status === 200)!.body.ownerId;
    expect((await t.owner.query(`SELECT owner_id FROM deals WHERE id = $1`, [lead.dealId])).rows[0].owner_id).toBe(winner);
  });

  it('un negocio con dueño no se puede tomar; sin el pool activo, tampoco', async () => {
    const pipeline = (await team.owner.api.get('/api/v1/pipelines').expect(200)).body[0];
    const owned = (await team.owner.api.post('/api/v1/deals', { title: 'Del propietario', pipelineId: pipeline.id }).expect(201)).body;
    expect((await team.owner.api.post(`/api/v1/deals/${owned.id}/claim`).expect(409)).body.code).toBe('LEAD_ALREADY_TAKEN');

    const lead = await newLead();
    await team.owner.api.patch('/api/v1/tenant/settings', { leadPool: false }).expect(200);
    expect((await team.owner.api.post(`/api/v1/deals/${lead.dealId}/claim`).expect(409)).body.code).toBe('LEAD_POOL_DISABLED');
    // Sin pool, el vendedor con "solo lo asignado" vuelve a ver solo lo suyo.
    await team.seller.api.get(`/api/v1/deals/${lead.dealId}`).expect(404);
  });
});
