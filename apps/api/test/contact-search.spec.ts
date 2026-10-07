import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTeam, createTestApp, type TestApp } from './support/test-app.js';

/** E02-S06 filtros + vistas guardadas, E02-S07 búsqueda global. */
describe('Filtros, vistas y búsqueda', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  const filter = (f: object) => `/api/v1/contacts?filter=${encodeURIComponent(JSON.stringify(f))}&limit=100`;
  const names = (res: { body: { items: { name: string }[] } }) => res.body.items.map((c) => c.name).sort();

  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Inmobiliaria Sur');
    const { api } = team.owner;
    await api.post('/api/v1/custom-fields', { entity: 'contact', key: 'ciudad', label: 'Ciudad', type: 'select', options: ['Bogotá', 'Medellín'] });
    await api.post('/api/v1/custom-fields', { entity: 'contact', key: 'presupuesto', label: 'Presupuesto', type: 'currency' });
    for (const c of [
      { name: 'José Álvarez', phone: '3001112233', tags: ['vip'], customFields: { ciudad: 'Bogotá', presupuesto: 500 } },
      { name: 'Ana Gómez', email: 'ana@finca.co', tags: ['vip', 'arriendo'], customFields: { ciudad: 'Medellín', presupuesto: 900 } },
      { name: 'Luis Peña', tags: ['arriendo'], customFields: { ciudad: 'Bogotá', presupuesto: 1500 }, ownerId: team.seller.userId },
    ]) await api.post('/api/v1/contacts', c).expect(201);
  });
  afterAll(() => t.close());

  describe('Filtros combinables (E02-S06)', () => {
    it.each([
      ['etiqueta', { match: 'all', conditions: [{ field: 'tags', op: 'has', value: 'vip' }] }, ['Ana Gómez', 'José Álvarez']],
      ['etiqueta Y campo', { match: 'all', conditions: [{ field: 'tags', op: 'has', value: 'arriendo' }, { field: 'custom.ciudad', op: 'eq', value: 'Bogotá' }] }, ['Luis Peña']],
      ['O lógico', { match: 'any', conditions: [{ field: 'custom.ciudad', op: 'eq', value: 'Medellín' }, { field: 'custom.presupuesto', op: 'gte', value: 1000 }] }, ['Ana Gómez', 'Luis Peña']],
      ['rango numérico', { match: 'all', conditions: [{ field: 'custom.presupuesto', op: 'lt', value: 1000 }] }, ['Ana Gómez', 'José Álvarez']],
      ['responsable', { match: 'all', conditions: [{ field: 'ownerId', op: 'eq', value: '__SELLER__' }] }, ['Luis Peña']],
      ['correo vacío', { match: 'all', conditions: [{ field: 'email', op: 'empty' }] }, ['José Álvarez', 'Luis Peña']],
      ['nombre contiene (sin tildes)', { match: 'all', conditions: [{ field: 'name', op: 'contains', value: 'alvarez' }] }, ['José Álvarez']],
    ])('%s', async (_, f, expected) => {
      const json = JSON.parse(JSON.stringify(f).replace('__SELLER__', team.seller.userId));
      expect(names(await team.owner.api.get(filter(json)).expect(200))).toEqual(expected);
    });

    it.each([
      ['campo inexistente', { match: 'all', conditions: [{ field: 'custom.color', op: 'eq', value: 'x' }] }],
      ['operador no válido para el tipo', { match: 'all', conditions: [{ field: 'tags', op: 'gte', value: 1 }] }],
      ['inyección en el campo', { match: 'all', conditions: [{ field: "name'; DROP TABLE contacts;--", op: 'eq', value: 1 }] }],
      ['JSON roto', 'no-es-json'],
    ])('rechaza con 400: %s', async (_, f) => {
      const raw = typeof f === 'string' ? f : JSON.stringify(f);
      await team.owner.api.get(`/api/v1/contacts?filter=${encodeURIComponent(raw)}`).expect(400);
    });
  });

  describe('Vistas guardadas (E02-S06)', () => {
    it('personales para quien las crea; compartidas para todo el equipo', async () => {
      const vip = { match: 'all', conditions: [{ field: 'tags', op: 'has', value: 'vip' }] };
      const mine = await team.seller.api.post('/api/v1/views', { entity: 'contact', name: 'Mis VIP', filters: vip }).expect(201);
      await team.seller.api.post('/api/v1/views', { entity: 'contact', name: 'X', filters: vip, shared: true }).expect(403);
      const shared = await team.admin.api.post('/api/v1/views', { entity: 'contact', name: 'VIP del equipo', filters: vip, shared: true }).expect(201);
      await team.admin.api.post('/api/v1/views', { entity: 'contact', name: 'Rota', filters: { match: 'all', conditions: [{ field: 'nada', op: 'eq', value: 1 }] } }).expect(400);

      const sellerViews = (await team.seller.api.get('/api/v1/views?entity=contact').expect(200)).body.map((v: { name: string }) => v.name);
      expect(sellerViews.sort()).toEqual(['Mis VIP', 'VIP del equipo']);
      const ownerViews = (await team.owner.api.get('/api/v1/views?entity=contact').expect(200)).body.map((v: { name: string }) => v.name);
      expect(ownerViews).toEqual(['VIP del equipo']);

      expect(names(await team.seller.api.get(`/api/v1/contacts?viewId=${shared.body.id}&limit=100`).expect(200))).toEqual(['Ana Gómez', 'José Álvarez']);
      await team.owner.api.get(`/api/v1/contacts?viewId=${mine.body.id}`).expect(404); // vista personal ajena
      await team.seller.api.del(`/api/v1/views/${shared.body.id}`).expect(403);
      await team.seller.api.del(`/api/v1/views/${mine.body.id}`).expect(204);
    });
  });

  describe('Búsqueda global (E02-S07)', () => {
    it.each([
      ['sin tildes', 'jose alvarez', 'José Álvarez'],
      ['mayúsculas', 'ANA', 'Ana Gómez'],
      ['correo', 'finca.co', 'Ana Gómez'],
      ['últimos dígitos del teléfono', '112233', 'José Álvarez'],
    ])('%s', async (_, q, expected) => {
      const res = await team.owner.api.get(`/api/v1/search?q=${encodeURIComponent(q)}`).expect(200);
      expect(res.body.contacts.map((c: { name: string }) => c.name)).toContain(expected);
    });

    it('no devuelve resultados de otra empresa', async () => {
      const other = as((await createTeam(t, 'Otra')).owner.agent);
      const res = await other.get('/api/v1/search?q=jose').expect(200);
      expect(res.body.contacts).toEqual([]);
    });

    it('responde en menos de 500 ms (p95) con 20.000 contactos', async () => {
      const tenantId = (await t.owner.query(`SELECT "organizationId" AS id FROM member WHERE "userId" = $1`, [team.owner.userId])).rows[0].id;
      await t.owner.query(
        `INSERT INTO contacts (tenant_id, name, phone, email)
         SELECT $1, 'Persona ' || g || ' ' || (ARRAY['Pérez','Gómez','Rodríguez','Martínez'])[1 + g % 4],
                '+5730' || lpad(g::text, 8, '0'), 'p' || g || '@demo.co'
         FROM generate_series(1, 20000) g`,
        [tenantId],
      );
      await t.owner.query('ANALYZE contacts');
      const timings: number[] = [];
      for (const q of ['rodriguez', 'gomez 19', '00012345', 'p777@', 'martinez', 'perez 5', '30000099', 'persona 1999', 'demo.co', 'zzz']) {
        for (let i = 0; i < 2; i++) {
          const start = performance.now();
          await team.owner.api.get(`/api/v1/search?q=${encodeURIComponent(q)}`).expect(200);
          timings.push(performance.now() - start);
        }
      }
      timings.sort((a, b) => a - b);
      expect(timings[Math.floor(timings.length * 0.95) - 1]).toBeLessThan(500);
    });

    it('exige al menos 2 caracteres', async () => {
      await team.owner.api.get('/api/v1/search?q=a').expect(400);
    });
  });
});
