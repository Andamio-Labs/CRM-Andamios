import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTeam, createTestApp, registerAndLogin, type TestApp } from './support/test-app.js';

/** E02-S01, E02-S03, E02-S04 + regla de visibilidad de E01-S04. */
describe('Contactos', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Clínica Andes');
  });
  afterAll(() => t.close());

  describe('CRUD (E02-S01)', () => {
    it('crea, lee, edita y elimina un contacto normalizando el teléfono a E.164', async () => {
      const { api } = team.owner;
      const created = await api.post('/api/v1/contacts', {
        name: 'María Pérez', phone: '300 123 4567', email: 'Maria@Correo.co', tags: ['vip', 'vip', 'eps'], notes: 'Prefiere WhatsApp',
      }).expect(201);
      expect(created.body).toMatchObject({ name: 'María Pérez', phone: '+573001234567', email: 'maria@correo.co', tags: ['vip', 'eps'] });

      const id = created.body.id;
      await api.patch(`/api/v1/contacts/${id}`, { phone: '+52 55 1234 5678', tags: ['mx'] }).expect(200);
      const read = await api.get(`/api/v1/contacts/${id}`).expect(200);
      expect(read.body).toMatchObject({ phone: '+525512345678', tags: ['mx'], notes: 'Prefiere WhatsApp' });

      await api.del(`/api/v1/contacts/${id}`).expect(204);
      await api.get(`/api/v1/contacts/${id}`).expect(404);
    });

    it.each([
      ['teléfono inválido', { name: 'X', phone: '123' }],
      ['teléfono fuera de LatAm', { name: 'X', phone: '+44 20 7946 0958' }],
      ['correo inválido', { name: 'X', email: 'no-es-correo' }],
      ['sin nombre', { name: '  ' }],
      ['dueño que no es del equipo', { name: 'X', ownerId: 'usuario-ajeno' }],
    ])('rechaza con 400: %s', async (_, body) => {
      await team.owner.api.post('/api/v1/contacts', body).expect(400);
    });

    it('el vendedor crea y edita, pero no elimina', async () => {
      const { body } = await team.seller.api.post('/api/v1/contacts', { name: 'Cliente del vendedor' }).expect(201);
      expect(body.ownerId).toBe(team.seller.userId); // por defecto, el creador es el responsable
      await team.seller.api.del(`/api/v1/contacts/${body.id}`).expect(403);
    });

    it('otra empresa no ve ni toca el contacto (404)', async () => {
      const { body } = await team.owner.api.post('/api/v1/contacts', { name: 'Privado' }).expect(201);
      const other = as((await registerAndLogin(t, 'Competencia')).agent);
      await other.get(`/api/v1/contacts/${body.id}`).expect(404);
      await other.patch(`/api/v1/contacts/${body.id}`, { name: 'Hackeado' }).expect(404);
      await other.del(`/api/v1/contacts/${body.id}`).expect(404);
    });
  });

  describe('Visibilidad del vendedor (E01-S04)', () => {
    it('con la regla activa el vendedor solo ve lo asignado; sin ella ve todo', async () => {
      const mine = await team.owner.api.post('/api/v1/contacts', { name: 'Asignado al vendedor', ownerId: team.seller.userId }).expect(201);
      const notMine = await team.owner.api.post('/api/v1/contacts', { name: 'Del propietario' }).expect(201);

      await team.owner.api.patch('/api/v1/tenant/settings', { sellersSeeOnlyAssigned: true }).expect(200);
      const list = await team.seller.api.get('/api/v1/contacts?limit=100').expect(200);
      const ids = list.body.items.map((c: { id: string }) => c.id);
      expect(ids).toContain(mine.body.id);
      expect(ids).not.toContain(notMine.body.id);
      await team.seller.api.get(`/api/v1/contacts/${notMine.body.id}`).expect(404);
      await team.seller.api.patch(`/api/v1/contacts/${notMine.body.id}`, { name: 'x' }).expect(404);
      const adminList = await team.admin.api.get('/api/v1/contacts?limit=100').expect(200);
      expect(adminList.body.items.map((c: { id: string }) => c.id)).toContain(notMine.body.id);

      await team.owner.api.patch('/api/v1/tenant/settings', { sellersSeeOnlyAssigned: false }).expect(200);
      const all = await team.seller.api.get('/api/v1/contacts?limit=100').expect(200);
      expect(all.body.items.map((c: { id: string }) => c.id)).toContain(notMine.body.id);
    });
  });

  describe('Organizaciones (E02-S03)', () => {
    it('una organización tiene varias personas y una persona varias organizaciones', async () => {
      const { api } = team.owner;
      const acme = (await api.post('/api/v1/companies', { name: 'Acme S.A.S.', domain: 'acme.co' }).expect(201)).body;
      const beta = (await api.post('/api/v1/companies', { name: 'Beta Ltda.' }).expect(201)).body;
      const ana = (await api.post('/api/v1/contacts', { name: 'Ana' }).expect(201)).body;
      const luis = (await api.post('/api/v1/contacts', { name: 'Luis' }).expect(201)).body;

      await api.put(`/api/v1/companies/${acme.id}/contacts/${ana.id}`, { jobTitle: 'Gerente' }).expect(204);
      await api.put(`/api/v1/companies/${acme.id}/contacts/${luis.id}`, {}).expect(204);
      await api.put(`/api/v1/companies/${beta.id}/contacts/${ana.id}`, {}).expect(204);

      const company = await api.get(`/api/v1/companies/${acme.id}`).expect(200);
      expect(company.body.contacts.map((c: { name: string }) => c.name).sort()).toEqual(['Ana', 'Luis']);
      const person = await api.get(`/api/v1/contacts/${ana.id}`).expect(200);
      expect(person.body.companies.map((c: { name: string }) => c.name).sort()).toEqual(['Acme S.A.S.', 'Beta Ltda.']);
      expect(person.body.companies.find((c: { name: string }) => c.name === 'Acme S.A.S.').jobTitle).toBe('Gerente');

      await api.del(`/api/v1/companies/${beta.id}/contacts/${ana.id}`).expect(204);
      const after = await api.get(`/api/v1/contacts/${ana.id}`).expect(200);
      expect(after.body.companies).toHaveLength(1);
    });

    it('no se puede vincular un contacto de otra empresa', async () => {
      const acme = (await team.owner.api.post('/api/v1/companies', { name: 'Propia' }).expect(201)).body;
      const other = as((await registerAndLogin(t)).agent);
      const foreign = (await other.post('/api/v1/contacts', { name: 'Ajeno' }).expect(201)).body;
      await team.owner.api.put(`/api/v1/companies/${acme.id}/contacts/${foreign.id}`, {}).expect(404);
    });
  });

  describe('Campos personalizados (E02-S04)', () => {
    it('admin define campos; los valores se validan por tipo', async () => {
      const { api } = team.admin;
      await api.post('/api/v1/custom-fields', { entity: 'contact', key: 'ciudad', label: 'Ciudad', type: 'text' }).expect(201);
      await api.post('/api/v1/custom-fields', { entity: 'contact', key: 'plan', label: 'Plan', type: 'select', options: ['basico', 'pro'] }).expect(201);
      await api.post('/api/v1/custom-fields', { entity: 'contact', key: 'ciudad', label: 'Otra', type: 'text' }).expect(409);
      await api.post('/api/v1/custom-fields', { entity: 'contact', key: 'Mal Key', label: 'X', type: 'text' }).expect(400);
      await api.post('/api/v1/custom-fields', { entity: 'contact', key: 'lista', label: 'Lista', type: 'select' }).expect(400); // sin opciones

      const ok = await api.post('/api/v1/contacts', { name: 'Con campos', customFields: { ciudad: 'Cali', plan: 'pro' } }).expect(201);
      expect(ok.body.customFields).toEqual({ ciudad: 'Cali', plan: 'pro' });
      await api.post('/api/v1/contacts', { name: 'X', customFields: { plan: 'gold' } }).expect(400);
      await api.post('/api/v1/contacts', { name: 'X', customFields: { inventado: 1 } }).expect(400);

      const list = await team.seller.api.get('/api/v1/custom-fields?entity=contact').expect(200);
      expect(list.body.map((f: { key: string }) => f.key)).toEqual(['ciudad', 'plan']);
      await team.seller.api.post('/api/v1/custom-fields', { entity: 'contact', key: 'x', label: 'X', type: 'text' }).expect(403);
    });

    it('máximo 50 campos por entidad', async () => {
      const api = as((await registerAndLogin(t)).agent);
      for (let i = 0; i < 50; i++) {
        await api.post('/api/v1/custom-fields', { entity: 'deal', key: `campo_${i}`, label: `Campo ${i}`, type: 'number' }).expect(201);
      }
      const res = await api.post('/api/v1/custom-fields', { entity: 'deal', key: 'campo_51', label: 'Uno más', type: 'number' }).expect(409);
      expect(res.body.code).toBe('CUSTOM_FIELD_LIMIT_REACHED');
    });

    it('al borrar un campo se eliminan sus valores de los contactos', async () => {
      const { api } = team.owner;
      const field = (await api.post('/api/v1/custom-fields', { entity: 'contact', key: 'temporal', label: 'Temporal', type: 'text' }).expect(201)).body;
      const contact = (await api.post('/api/v1/contacts', { name: 'Temp', customFields: { temporal: 'x' } }).expect(201)).body;
      await api.del(`/api/v1/custom-fields/${field.id}`).expect(204);
      const read = await api.get(`/api/v1/contacts/${contact.id}`).expect(200);
      expect(read.body.customFields).not.toHaveProperty('temporal');
    });
  });
});
