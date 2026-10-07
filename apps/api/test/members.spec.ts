import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_URL, createTestApp, inviteAndJoin, registerAndLogin, type TestApp } from './support/test-app.js';

/** E01-S04 — Pruebas de autorización sobre el equipo. */
describe('/api/v1/members (E01-S04)', () => {
  let t: TestApp;
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.close());

  async function team() {
    const owner = await registerAndLogin(t);
    const admin = await inviteAndJoin(t, owner.agent, 'admin');
    const seller = await inviteAndJoin(t, owner.agent, 'member');
    return { owner, admin, seller };
  }

  it('propietario y admin ven el equipo; el vendedor no', async () => {
    const { owner, admin, seller } = await team();
    const res = await owner.agent.get('/api/v1/members').expect(200);
    expect(res.body.map((m: { role: string }) => m.role).sort()).toEqual(['admin', 'member', 'owner']);
    await admin.agent.get('/api/v1/members').expect(200);
    await seller.agent.get('/api/v1/members').expect(403);
  });

  it('solo el propietario cambia roles', async () => {
    const { owner, admin, seller } = await team();
    await admin.agent.patch(`/api/v1/members/${seller.memberId}`).set('Origin', APP_URL).send({ role: 'admin' }).expect(403);
    const res = await owner.agent.patch(`/api/v1/members/${seller.memberId}`).set('Origin', APP_URL).send({ role: 'admin' }).expect(200);
    expect(res.body.role).toBe('admin');
  });

  it('nadie puede degradar ni quitar al propietario', async () => {
    const { owner, admin } = await team();
    const ownerMember = (await owner.agent.get('/api/v1/members')).body.find((m: { role: string }) => m.role === 'owner');
    await owner.agent.patch(`/api/v1/members/${ownerMember.id}`).set('Origin', APP_URL).send({ role: 'member' }).expect(422);
    await admin.agent.delete(`/api/v1/members/${ownerMember.id}`).set('Origin', APP_URL).expect(403);
    await owner.agent.delete(`/api/v1/members/${ownerMember.id}`).set('Origin', APP_URL).expect(422);
  });

  it('el admin quita vendedores pero no a otros admins', async () => {
    const { owner, admin, seller } = await team();
    await admin.agent.delete(`/api/v1/members/${seller.memberId}`).set('Origin', APP_URL).expect(204);

    // Se liberó un cupo del trial (3 usuarios): entra un segundo admin.
    const secondAdmin = await inviteAndJoin(t, owner.agent, 'admin');
    await admin.agent.delete(`/api/v1/members/${secondAdmin.memberId}`).set('Origin', APP_URL).expect(403);
  });

  it('un miembro quitado pierde el acceso de inmediato', async () => {
    const { owner, seller } = await team();
    await seller.agent.get('/api/v1/tenant/settings').expect(200);
    await owner.agent.delete(`/api/v1/members/${seller.memberId}`).set('Origin', APP_URL).expect(204);
    await seller.agent.get('/api/v1/tenant/settings').expect(401);
  });

  it('no se puede tocar a un miembro de OTRA empresa', async () => {
    const a = await team();
    const b = await registerAndLogin(t, 'Otra empresa');
    await b.agent.delete(`/api/v1/members/${a.seller.memberId}`).set('Origin', APP_URL).expect(404);
    await b.agent.patch(`/api/v1/members/${a.seller.memberId}`).set('Origin', APP_URL).send({ role: 'admin' }).expect(404);
  });
});
