import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTeam, createTestApp, registerAndLogin, as, type TestApp } from './support/test-app.js';
import { connectChannel } from './support/whatsapp.js';

interface Step { key: string; label: string; done: boolean; doneAt: string | null }
interface Onboarding { steps: Step[]; progress: number; completed: boolean; dismissed: boolean }

/** E14-S03 — Onboarding guiado: conectar WhatsApp, elegir embudo, importar contactos, invitar al equipo. */
describe('Onboarding guiado (E14-S03)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const onboarding = async (api: ReturnType<typeof as>) => (await api.get('/api/v1/onboarding').expect(200)).body as Onboarding;
  const step = (o: Onboarding, key: string) => o.steps.find((s) => s.key === key)!;

  it('una empresa nueva arranca con los 4 pasos pendientes y ve las plantillas de embudo', async () => {
    const { agent } = await registerAndLogin(t, 'Recién Llegada SAS');
    const o = await onboarding(as(agent));
    expect(o.steps.map((s) => s.key)).toEqual(['whatsapp', 'pipeline', 'import', 'team']);
    expect(o).toMatchObject({ progress: 0, completed: false, dismissed: false });
    const templates = (await as(agent).get('/api/v1/onboarding/pipeline-templates').expect(200)).body;
    expect(templates.map((x: { id: string }) => x.id)).toEqual(['general', 'clinic', 'real_estate', 'education', 'retail', 'services']);
    expect(templates[1].stages.length).toBeGreaterThanOrEqual(4);
  });

  it('elegir plantilla con el embudo inicial vacío lo transforma (no duplica)', async () => {
    const { agent } = await registerAndLogin(t, 'Inmobiliaria SAS');
    const api = as(agent);
    await api.post('/api/v1/onboarding/pipeline-template', { template: 'real_estate' }).expect(200);
    const pipelines = (await api.get('/api/v1/pipelines').expect(200)).body;
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0].name).toBe('Inmobiliaria');
    expect(pipelines[0].stages.map((s: { name: string }) => s.name)).toContain('Visita agendada');
    const o = await onboarding(api);
    expect(step(o, 'pipeline')).toMatchObject({ done: true });
    expect(o.progress).toBe(25);
  });

  it('si el embudo inicial ya tiene negocios, la plantilla crea uno nuevo', async () => {
    const { agent } = await registerAndLogin(t, 'Con Negocios SAS');
    const api = as(agent);
    const [first] = (await api.get('/api/v1/pipelines').expect(200)).body;
    await api.post('/api/v1/deals', { title: 'Negocio existente', pipelineId: first.id }).expect(201);
    await api.post('/api/v1/onboarding/pipeline-template', { template: 'clinic' }).expect(200);
    const names = (await api.get('/api/v1/pipelines').expect(200)).body.map((p: { name: string }) => p.name);
    expect(names).toEqual(['Ventas', 'Clínica']);
  });

  it('cada paso se marca solo cuando pasa de verdad; al completar todo llega al 100 %', async () => {
    const team = await createTeam(t, 'Completa SAS'); // invitar al equipo ya está hecho
    let o = await onboarding(team.owner.api);
    expect(step(o, 'team').done).toBe(true);
    expect(step(o, 'whatsapp').done).toBe(false);

    await connectChannel(team.owner.api);
    await team.owner.api.post('/api/v1/onboarding/pipeline-template', { template: 'general' }).expect(200);
    await t.owner.query(`INSERT INTO import_jobs (tenant_id, file_key, headers, status, finished_at)
      SELECT m."organizationId", 'x.csv', '{nombre}', 'done', now() FROM member m JOIN "user" u ON u.id = m."userId" WHERE u.email = $1`, [team.owner.email]);

    o = await onboarding(team.owner.api);
    expect(o.steps.every((s) => s.done && s.doneAt)).toBe(true);
    expect(o).toMatchObject({ progress: 100, completed: true });
  });

  it('el vendedor ve el avance pero no elige embudo; se puede ocultar la guía', async () => {
    const team = await createTeam(t, 'Oculta SAS');
    await onboarding(team.seller.api);
    await team.seller.api.post('/api/v1/onboarding/pipeline-template', { template: 'retail' }).expect(403);
    await team.seller.api.post('/api/v1/onboarding/dismiss').expect(403);
    await team.owner.api.post('/api/v1/onboarding/dismiss').expect(204);
    expect((await onboarding(team.owner.api)).dismissed).toBe(true);
  });

  it('plantilla inexistente es 400', async () => {
    const { agent } = await registerAndLogin(t, 'Plantilla Mala SAS');
    await as(agent).post('/api/v1/onboarding/pipeline-template', { template: 'restaurante' }).expect(400);
  });
});
