import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTeam, createTestApp, type TestApp } from './support/test-app.js';

interface Entry { action: string; entity: string; entityId: string | null; actorId: string | null; actorName: string | null; data: Record<string, unknown>; createdAt: string }

/** E13-S06 — Quién vio, modificó, exportó o eliminó datos; consultable y no editable. */
describe('Registro de auditoría (E13-S06)', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  const audit = async (query = '') => (await team.owner.api.get(`/api/v1/audit${query}`).expect(200)).body as { items: Entry[]; nextCursor: string | null };

  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Auditada SAS');
  });
  afterAll(() => t.close());

  it('registra crear, modificar y eliminar con quién, qué entidad y qué campos, sin copiar los valores', async () => {
    const id = (await team.seller.api.post('/api/v1/contacts', { name: 'Juana Secreta', phone: '3009998877' }).expect(201)).body.id;
    await team.seller.api.patch(`/api/v1/contacts/${id}`, { email: 'juana@secreta.co' }).expect(200);
    await team.admin.api.del(`/api/v1/contacts/${id}`).expect(204);

    const { items } = await audit(`?entityId=${id}`);
    expect(items.map((e) => [e.action, e.entity, e.actorId])).toEqual([
      ['delete', 'contacts', team.admin.userId],
      ['update', 'contacts', team.seller.userId],
      ['create', 'contacts', team.seller.userId],
    ]);
    expect(items[1]!.data.fields).toEqual(['email']);
    expect(items[2]!.actorName).toBeTruthy();
    expect(JSON.stringify(items)).not.toMatch(/Juana|3009998877|secreta\.co/);
  });

  it('registra quién vio la ficha de un contacto y su historial', async () => {
    const id = (await team.owner.api.post('/api/v1/contacts', { name: 'Vista' }).expect(201)).body.id;
    await team.seller.api.get(`/api/v1/contacts/${id}`).expect(200);
    await team.seller.api.get(`/api/v1/contacts/${id}/timeline`).expect(200);
    const { items } = await audit(`?entityId=${id}&action=view`);
    expect(items).toHaveLength(2);
    expect(items.every((e) => e.actorId === team.seller.userId)).toBe(true);
  });

  it('acciones específicas quedan con su nombre (mover, cerrar) y las exportaciones también aparecen', async () => {
    const pipeline = (await team.owner.api.get('/api/v1/pipelines').expect(200)).body[0];
    const deal = (await team.owner.api.post('/api/v1/deals', { title: 'Negocio auditado', pipelineId: pipeline.id }).expect(201)).body;
    await team.owner.api.post(`/api/v1/deals/${deal.id}/move`, { stageId: pipeline.stages[1].id }).expect((r) => { if (r.status >= 300) throw new Error(r.text); });
    await team.owner.agent.get('/api/v1/exports/contacts.csv').expect(200);
    expect((await audit(`?entityId=${deal.id}`)).items.map((e) => e.action)).toEqual(['move', 'create']);
    expect((await audit('?action=export')).items.length).toBeGreaterThanOrEqual(1);
  });

  it('filtra por persona y pagina con cursor', async () => {
    for (let i = 0; i < 5; i++) await team.admin.api.post('/api/v1/contacts', { name: `Página ${i}`, allowDuplicate: true }).expect(201);
    const first = await audit(`?actorId=${team.admin.userId}&action=create&limit=3`);
    expect(first.items).toHaveLength(3);
    expect(first.items.every((e) => e.actorId === team.admin.userId)).toBe(true);
    const second = await audit(`?actorId=${team.admin.userId}&action=create&limit=3&cursor=${first.nextCursor}`);
    expect(second.items.length).toBeGreaterThanOrEqual(2);
    const ids = new Set([...first.items, ...second.items].map((e) => e.createdAt + e.entityId));
    expect(ids.size).toBe(first.items.length + second.items.length);
  });

  it('solo el propietario lo consulta; nadie lo puede editar ni borrar; otra empresa no lo ve', async () => {
    await team.admin.api.get('/api/v1/audit').expect(403);
    await team.seller.api.get('/api/v1/audit').expect(403);
    await team.owner.api.del('/api/v1/audit').expect(404);
    const { rows: [privs] } = await t.owner.query<{ upd: boolean; del: boolean }>(
      `SELECT has_table_privilege('beecrm_app', 'audit_log', 'UPDATE') AS upd, has_table_privilege('beecrm_app', 'audit_log', 'DELETE') AS del`);
    expect(privs).toEqual({ upd: false, del: false });
    const other = (await createTeam(t, 'Otra auditada')).owner.api;
    expect((await other.get('/api/v1/audit?action=update').expect(200)).body.items).toEqual([]);
  });

  it('no registra ruido: marcar notificaciones como leídas', async () => {
    await team.owner.api.post('/api/v1/notifications/read-all').expect(204);
    expect((await audit('?entity=notifications')).items).toEqual([]);
  });
});
