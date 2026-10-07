import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTeam, createTestApp, type TestApp } from './support/test-app.js';

/** E02-S02 duplicados, E02-S08 importación, E02-S09 exportación. */
describe('Duplicados, importación y exportación', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Datos SAS');
  });
  afterAll(() => t.close());

  const upload = (agent: typeof team.owner.agent, csv: string, name = 'clientes.csv') =>
    agent.post('/api/v1/imports').set('Origin', 'http://localhost:5173').attach('file', Buffer.from(csv), name);

  describe('Duplicados (E02-S02)', () => {
    it('advierte al crear con un teléfono o correo existente; se puede forzar', async () => {
      const { api } = team.owner;
      const original = (await api.post('/api/v1/contacts', { name: 'Original', phone: '3009990001', email: 'dup@x.co' }).expect(201)).body;
      const byPhone = await api.post('/api/v1/contacts', { name: 'Copia', phone: '+57 300 999 0001' }).expect(409);
      expect(byPhone.body).toMatchObject({ code: 'DUPLICATE_CONTACT', duplicates: [{ id: original.id, matchedBy: 'phone' }] });
      const byEmail = await api.post('/api/v1/contacts', { name: 'Copia', email: 'DUP@x.co' }).expect(409);
      expect(byEmail.body.duplicates[0]).toMatchObject({ id: original.id, matchedBy: 'email' });
      await api.post('/api/v1/contacts', { name: 'Copia forzada', phone: '3009990001', allowDuplicate: true }).expect(201);
    });

    it('fusionar conserva negocios, tareas y conversaciones, completa datos y borra el duplicado', async () => {
      const { api } = team.owner;
      const pipeline = (await api.get('/api/v1/pipelines').expect(200)).body[0];
      const primary = (await api.post('/api/v1/contacts', { name: 'Principal', phone: '3008880001' }).expect(201)).body;
      const dup = (await api.post('/api/v1/contacts', { name: 'Duplicado', phone: '3008880001', email: 'completo@x.co', tags: ['vip'], allowDuplicate: true }).expect(201)).body;
      const deal = (await api.post('/api/v1/deals', { title: 'Del duplicado', pipelineId: pipeline.id, contactId: dup.id }).expect(201)).body;
      const task = (await api.post('/api/v1/tasks', { title: 'Tarea del duplicado', contactId: dup.id }).expect(201)).body;

      const merged = (await api.post(`/api/v1/contacts/${primary.id}/merge`, { duplicateId: dup.id }).expect(200)).body;
      expect(merged).toMatchObject({ id: primary.id, name: 'Principal', email: 'completo@x.co', tags: ['vip'] });
      await api.get(`/api/v1/contacts/${dup.id}`).expect(404);
      expect((await t.owner.query(`SELECT contact_id FROM deals WHERE id = $1`, [deal.id])).rows[0].contact_id).toBe(primary.id);
      expect((await t.owner.query(`SELECT contact_id FROM tasks WHERE id = $1`, [task.id])).rows[0].contact_id).toBe(primary.id);
      await team.seller.api.post(`/api/v1/contacts/${primary.id}/merge`, { duplicateId: primary.id }).expect(403);
    });
  });

  describe('Importación CSV (E02-S08)', () => {
    it('sube, muestra vista previa con mapeo sugerido, importa y entrega reporte de errores', async () => {
      const csv = [
        'Nombre,Teléfono,Correo,Etiquetas,Prioridad',
        'Laura Díaz,3101112233,laura@x.co,vip;feria,Alta',
        'Sin teléfono válido,123,,,',
        ',3101112234,,,',
        'Pedro Gil,3101112235,pedro@x.co,,Media',
        'Duplicada,3101112233,,,',
      ].join('\n');
      const preview = (await upload(team.admin.agent, csv).expect(201)).body;
      expect(preview).toMatchObject({ totalRows: 5, headers: ['Nombre', 'Teléfono', 'Correo', 'Etiquetas', 'Prioridad'] });
      expect(preview.sample).toHaveLength(5);
      expect(preview.suggestedMapping).toEqual({ Nombre: 'name', Teléfono: 'phone', Correo: 'email', Etiquetas: 'tags', Prioridad: 'priority' });

      const done = (await team.admin.api.post(`/api/v1/imports/${preview.id}/start`, { mapping: preview.suggestedMapping }).expect(200)).body;
      expect(done).toMatchObject({ status: 'done', imported: 2, skipped: 3 });

      const report = new URL(done.reportUrl);
      const text = (await t.http().get(`${report.pathname}${report.search}`).buffer(true).parse((res, cb) => {
        let data = '';
        res.on('data', (c: Buffer) => (data += c));
        res.on('end', () => cb(null, data));
      }).expect(200)).body as string;
      expect(text).toContain('fila,motivo');
      expect(text).toMatch(/3,.*teléfono/i);
      expect(text).toMatch(/4,.*nombre/i);
      expect(text).toMatch(/6,.*duplicad/i);

      const laura = (await team.admin.api.get('/api/v1/search?q=laura').expect(200)).body.contacts[0];
      expect(laura).toMatchObject({ phone: '+573101112233' });
    });

    it('rechaza archivos que no son CSV, vacíos o con más de 50.000 filas', async () => {
      await upload(team.owner.agent, 'nombre\n', 'vacio.csv').expect(400);
      await upload(team.owner.agent, 'GIF89a', 'foto.gif').expect(400);
      const huge = `nombre\n${'x\n'.repeat(50_001)}`;
      const res = await upload(team.owner.agent, huge).expect(400);
      expect(res.body.message).toMatch(/50\.000/);
    });

    it('el vendedor no importa', async () => {
      await upload(team.seller.agent, 'Nombre\nA').expect(403);
    });

    it('importa 5.000 filas en menos de 15 s', async () => {
      const rows = Array.from({ length: 5000 }, (_, i) => `Cliente ${i},31${String(20000000 + i)},c${i}@lote.co`);
      const preview = (await upload(team.owner.agent, `Nombre,Teléfono,Correo\n${rows.join('\n')}`).expect(201)).body;
      const start = Date.now();
      const done = (await team.owner.api.post(`/api/v1/imports/${preview.id}/start`, { mapping: preview.suggestedMapping }).expect(200)).body;
      expect(done.imported).toBe(5000);
      expect(Date.now() - start).toBeLessThan(15_000);
    });
  });

  describe('Exportación (E02-S09)', () => {
    it.each(['contacts', 'deals', 'tasks'])('el propietario exporta %s en CSV y queda en auditoría', async (entity) => {
      const res = await team.owner.agent.get(`/api/v1/exports/${entity}.csv`).expect(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(new RegExp(`attachment; filename="${entity}-`));
      const { rows } = await t.owner.query(`SELECT action, entity FROM audit_log WHERE action = 'export' AND entity = $1`, [entity]);
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it('nadie más exporta', async () => {
      await team.admin.agent.get('/api/v1/exports/contacts.csv').expect(403);
      await team.seller.agent.get('/api/v1/exports/contacts.csv').expect(403);
    });

    it('neutraliza fórmulas al exportar (inyección CSV en Excel)', async () => {
      await team.owner.api.post('/api/v1/contacts', { name: '=HYPERLINK("http://malo.co","clic")', allowDuplicate: true }).expect(201);
      const res = await team.owner.agent.get('/api/v1/exports/contacts.csv').expect(200);
      expect(res.text).toContain(`"'=HYPERLINK(""http://malo.co"",""clic"")"`);
    });
  });
});
