import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTeam, registerAndLogin, type TestApp, createTestApp } from './support/test-app.js';

type Company = { id: string; name: string; role: string; active: boolean; joinCode: string | null; currency: string; createdAt: string; crmConfigured: boolean; funnelCreated: boolean };
type Api = ReturnType<typeof as>;

/** E01-S10 — Multiempresa: crear, cambiar de empresa y unirse con código (lo aprueba el equipo). */
describe('Multiempresa (E01-S10)', () => {
  let t: TestApp;
  let full: Awaited<ReturnType<typeof createTeam>>;
  let host: Api;
  let guest: Api;
  let other: Api;

  beforeAll(async () => {
    t = await createTestApp();
    full = await createTeam(t, 'Equipo Lleno SAS');
    host = as((await registerAndLogin(t, 'Anfitriona SAS')).agent);
    guest = as((await registerAndLogin(t, 'Visitante SAS')).agent);
    other = as((await registerAndLogin(t, 'Otra SAS')).agent);
  });
  afterAll(() => t.close());

  const companies = async (api: Api) => (await api.get('/api/v1/my-companies').expect(200)).body as Company[];
  const codeOf = async (api: Api) => (await companies(api)).find((c) => c.active)!.joinCode!;

  it('lista mis empresas con mi rol, el código para invitar y el estado del CRM', async () => {
    const [mine] = await companies(host);
    expect(mine).toMatchObject({ name: 'Anfitriona SAS', role: 'owner', active: true, currency: 'COP', funnelCreated: true, crmConfigured: false });
    expect(mine!.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(Date.parse(mine!.createdAt)).toBeGreaterThan(0);
  });

  it('el vendedor no ve el código: no puede invitar', async () => {
    const [mine] = await companies(full.seller.api);
    expect(mine).toMatchObject({ role: 'member', joinCode: null });
  });

  it('crear una empresa la deja activa, con embudo, y se puede volver a la anterior', async () => {
    const created = (await other.post('/api/v1/my-companies', { name: 'Segunda Otra SAS' }).expect(201)).body as { id: string };
    let list = await companies(other);
    expect(list).toHaveLength(2);
    expect(list.find((c) => c.active)).toMatchObject({ id: created.id, name: 'Segunda Otra SAS', role: 'owner', funnelCreated: true });
    expect((await other.get('/api/v1/pipelines').expect(200)).body.length).toBeGreaterThan(0);

    const first = list.find((c) => !c.active)!;
    await other.post(`/api/v1/my-companies/${first.id}/activate`).expect(204);
    list = await companies(other);
    expect(list.find((c) => c.active)?.id).toBe(first.id);
  });

  it('no deja activar una empresa de la que no soy parte', async () => {
    const [foreign] = await companies(host);
    await other.post(`/api/v1/my-companies/${foreign!.id}/activate`).expect(404);
  });

  it('valida el nombre de la empresa nueva', async () => {
    await other.post('/api/v1/my-companies', { name: 'X' }).expect(400);
  });

  describe('unirse con código', () => {
    it('un código que no existe no revela nada', async () => {
      expect((await guest.post('/api/v1/my-companies/join', { code: 'ZZZZZZZZZZ' }).expect(404)).body.code).toBe('JOIN_CODE_NOT_FOUND');
    });

    it('no puedo pedir unirme a mi propia empresa', async () => {
      expect((await host.post('/api/v1/my-companies/join', { code: await codeOf(host) }).expect(409)).body.code).toBe('ALREADY_MEMBER');
    });

    it('la solicitud queda pendiente, una sola vez, y aparece en "Mis solicitudes"', async () => {
      const code = (await codeOf(host)).toLowerCase(); // se acepta en minúsculas
      const request = (await guest.post('/api/v1/my-companies/join', { code }).expect(201)).body;
      expect(request).toMatchObject({ companyName: 'Anfitriona SAS', status: 'pending' });
      expect((await guest.post('/api/v1/my-companies/join', { code }).expect(409)).body.code).toBe('ALREADY_REQUESTED');

      const mine = (await guest.get('/api/v1/my-companies/requests').expect(200)).body;
      expect(mine).toEqual([expect.objectContaining({ companyName: 'Anfitriona SAS', status: 'pending' })]);
    });

    it('el equipo de la empresa ve la solicitud y se avisa a quien puede aprobar', async () => {
      const pending = (await host.get('/api/v1/join-requests').expect(200)).body;
      expect(pending).toEqual([expect.objectContaining({ name: 'Dueña', status: 'pending' })]);
      const bell = (await host.get('/api/v1/notifications').expect(200)).body;
      expect(bell.items.some((n: { type: string }) => n.type === 'join_request')).toBe(true);
    });

    it('el vendedor no puede aprobar', async () => {
      await full.seller.api.get('/api/v1/join-requests').expect(403);
    });

    it('al aprobar, la persona entra como vendedor y puede cambiarse a esa empresa', async () => {
      const [request] = (await host.get('/api/v1/join-requests').expect(200)).body;
      await host.post(`/api/v1/join-requests/${request.id}/approve`).expect(204);

      const list = await companies(guest);
      const joined = list.find((c) => c.name === 'Anfitriona SAS')!;
      expect(joined).toMatchObject({ role: 'member', active: false });
      expect((await guest.get('/api/v1/my-companies/requests').expect(200)).body[0]).toMatchObject({ status: 'approved' });
      await guest.post(`/api/v1/my-companies/${joined.id}/activate`).expect(204);
      expect((await companies(guest)).find((c) => c.active)?.name).toBe('Anfitriona SAS');
    });

    it('rechazar deja la solicitud como rechazada', async () => {
      await other.post('/api/v1/my-companies/join', { code: await codeOf(host) }).expect(201);
      const [request] = (await host.get('/api/v1/join-requests').expect(200)).body;
      await host.post(`/api/v1/join-requests/${request.id}/reject`).expect(204);
      expect((await other.get('/api/v1/my-companies/requests').expect(200)).body[0]).toMatchObject({ companyName: 'Anfitriona SAS', status: 'rejected' });
      expect((await host.get('/api/v1/join-requests').expect(200)).body).toHaveLength(0);
    });

    it('con el cupo del plan lleno no se puede aprobar', async () => {
      await guest.post('/api/v1/my-companies/join', { code: await codeOf(full.owner.api) }).expect(201);
      const [request] = (await full.owner.api.get('/api/v1/join-requests').expect(200)).body;
      expect((await full.owner.api.post(`/api/v1/join-requests/${request.id}/approve`).expect(409)).body.code).toBe('PLAN_USER_LIMIT_REACHED');
    });

    it('puedo cancelar una solicitud pendiente', async () => {
      const [request] = (await guest.get('/api/v1/my-companies/requests').expect(200)).body.filter((r: { status: string }) => r.status === 'pending');
      await guest.del(`/api/v1/my-companies/requests/${request.id}`).expect(204);
      expect((await full.owner.api.get('/api/v1/join-requests').expect(200)).body).toHaveLength(0);
    });
  });

  it('solo el propietario renombra la empresa activa', async () => {
    await full.admin.api.patch('/api/v1/my-companies/current', { name: 'Nuevo nombre' }).expect(403);
    await full.owner.api.patch('/api/v1/my-companies/current', { name: 'Equipo Renombrado SAS' }).expect(204);
    expect((await companies(full.owner.api))[0]?.name).toBe('Equipo Renombrado SAS');
  });
});
