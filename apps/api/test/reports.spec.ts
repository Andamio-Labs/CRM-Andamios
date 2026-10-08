import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReportsService } from '../src/modules/reports/reports.service.js';
import { createTeam, createTestApp, type TestApp } from './support/test-app.js';
import { connectChannel, conversationOf, inboundText, newPhoneId, sendWebhook } from './support/whatsapp.js';

/** E08-S01 panel, E08-S02 primera respuesta y SLA, E08-S03 rendimiento por vendedor y fuente. */
describe('Reportes', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  let pipeline: { id: string; stages: { id: string; name: string }[] };
  let reasons: { id: string; outcome: string }[];

  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Reportes SAS');
    pipeline = (await team.owner.api.get('/api/v1/pipelines').expect(200)).body[0];
    reasons = (await team.owner.api.get('/api/v1/close-reasons').expect(200)).body;

    // Leads: 3 de Facebook, 1 de referido.
    for (const [name, source] of [['L1', 'facebook'], ['L2', 'facebook'], ['L3', 'facebook'], ['L4', 'referido']] as const) {
      await team.owner.api.post('/api/v1/contacts', { name, source, allowDuplicate: true }).expect(201);
    }
    // Negocios: vendedor gana 1 (1.000.000) y pierde 1; admin gana 1 (500.000); 2 abiertos (300.000 en etapa 2, 200.000 en etapa 1).
    const deal = async (title: string, ownerId: string, value: number, source: string, stage = 0) =>
      (await team.owner.api.post('/api/v1/deals', { title, pipelineId: pipeline.id, stageId: pipeline.stages[stage]!.id, ownerId, value, source }).expect(201)).body.id as string;
    const close = (id: string, outcome: 'won' | 'lost') =>
      team.owner.api.post(`/api/v1/deals/${id}/close`, { outcome, reasonId: reasons.find((r) => r.outcome === outcome)!.id }).expect(200);
    await close(await deal('Ganado vendedor', team.seller.userId, 1_000_000, 'facebook'), 'won');
    await close(await deal('Perdido vendedor', team.seller.userId, 400_000, 'facebook'), 'lost');
    await close(await deal('Ganado admin', team.admin.userId, 500_000, 'referido'), 'won');
    await deal('Abierto 1', team.seller.userId, 300_000, 'facebook', 1);
    await deal('Abierto 2', team.admin.userId, 200_000, 'referido', 0);
  });
  afterAll(() => t.close());

  describe('Panel (E08-S01)', () => {
    it('leads nuevos, negocios por etapa, conversión y valor del embudo', async () => {
      const r = (await team.owner.api.get(`/api/v1/reports/overview?pipelineId=${pipeline.id}`).expect(200)).body;
      expect(r.newLeads).toBe(4);
      expect(r.pipelineValue).toBe(500_000);
      expect(r.won).toMatchObject({ count: 2, value: 1_500_000 });
      expect(r.lost).toMatchObject({ count: 1 });
      expect(r.conversionRate).toBeCloseTo(2 / 3, 5);
      const byStage = Object.fromEntries(r.dealsByStage.map((s: { stageId: string; count: number; value: number }) => [s.stageId, s]));
      expect(byStage[pipeline.stages[0]!.id]).toMatchObject({ count: 1, value: 200_000 });
      expect(byStage[pipeline.stages[1]!.id]).toMatchObject({ count: 1, value: 300_000 });
      expect(r.dealsByStage.map((s: { name: string }) => s.name)).toEqual(pipeline.stages.map((s) => s.name));
    });

    it('el rango de fechas filtra lo que pasó en ese período', async () => {
      const r = (await team.owner.api.get('/api/v1/reports/overview?from=2020-01-01&to=2020-01-31').expect(200)).body;
      expect(r).toMatchObject({ newLeads: 0, won: { count: 0, value: 0 }, lost: { count: 0 }, conversionRate: null });
      await team.owner.api.get('/api/v1/reports/overview?from=2026-02-01&to=2026-01-01').expect(400);
    });

    it('el vendedor solo ve sus números', async () => {
      const r = (await team.seller.api.get('/api/v1/reports/overview').expect(200)).body;
      expect(r.won).toMatchObject({ count: 1, value: 1_000_000 });
      expect(r.pipelineValue).toBe(300_000);
    });
  });

  describe('Rendimiento (E08-S03)', () => {
    it('por responsable: negocios, ingresos y conversión', async () => {
      const r = (await team.owner.api.get('/api/v1/reports/performance').expect(200)).body;
      const seller = r.byOwner.find((x: { ownerId: string }) => x.ownerId === team.seller.userId);
      expect(seller).toMatchObject({ deals: 3, won: 1, lost: 1, wonValue: 1_000_000, conversionRate: 0.5 });
      expect(seller.name).toBeTruthy();
      expect(r.byOwner.find((x: { ownerId: string }) => x.ownerId === team.admin.userId)).toMatchObject({ won: 1, lost: 0, conversionRate: 1 });
    });

    it('por fuente: leads, negocios, ingresos y conversión', async () => {
      const r = (await team.owner.api.get('/api/v1/reports/performance').expect(200)).body;
      expect(r.bySource.find((x: { source: string }) => x.source === 'facebook')).toMatchObject({ leads: 3, deals: 3, won: 1, wonValue: 1_000_000, conversionRate: 0.5 });
      expect(r.bySource.find((x: { source: string }) => x.source === 'referido')).toMatchObject({ leads: 1, won: 1, wonValue: 500_000 });
    });

    it('el vendedor no ve el rendimiento del equipo', async () => {
      const r = (await team.seller.api.get('/api/v1/reports/performance').expect(200)).body;
      expect(r.byOwner.map((x: { ownerId: string }) => x.ownerId)).toEqual([team.seller.userId]);
    });
  });

  describe('Primera respuesta y SLA (E08-S02)', () => {
    let pnid: string;

    beforeAll(async () => {
      pnid = newPhoneId();
      await connectChannel(team.owner.api, pnid).expect(201);
      await team.owner.api.patch('/api/v1/tenant/settings', { firstResponseSlaMinutes: 20 }).expect(200);
    });

    it('promedio de primera respuesta por vendedor y cuántas superaron el SLA; las respuestas automáticas no cuentan', async () => {
      // Cliente A escribe hace 30 min y el vendedor responde ahora (30 min > SLA 20).
      await sendWebhook(t, inboundText(pnid, '573101110001', 'Hola A', { at: Date.now() - 30 * 60_000 })).expect(200);
      // Cliente B escribe hace 10 min y el admin responde ahora (10 min).
      await sendWebhook(t, inboundText(pnid, '573101110002', 'Hola B', { at: Date.now() - 10 * 60_000 })).expect(200);
      const a = await conversationOf(team.owner.api, '+573101110001');
      const b = await conversationOf(team.owner.api, '+573101110002');
      await team.seller.api.post(`/api/v1/conversations/${a.id}/messages`, { type: 'text', text: 'Hola, ¿en qué te ayudo?' }).expect(202);
      await team.admin.api.post(`/api/v1/conversations/${b.id}/messages`, { type: 'text', text: 'Hola' }).expect(202);

      const r = (await team.owner.api.get('/api/v1/reports/response-times').expect(200)).body;
      expect(r.slaMinutes).toBe(20);
      const seller = r.byResponder.find((x: { userId: string }) => x.userId === team.seller.userId);
      const admin = r.byResponder.find((x: { userId: string }) => x.userId === team.admin.userId);
      expect(seller).toMatchObject({ conversations: 1, breaches: 1 });
      expect(seller.avgMinutes).toBeGreaterThanOrEqual(29);
      expect(admin).toMatchObject({ conversations: 1, breaches: 0 });
      expect(admin.avgMinutes).toBeLessThan(12);
      expect(r.overall.conversations).toBe(2);
    });

    it('alerta una vez cuando una conversación supera el SLA sin primera respuesta', async () => {
      await sendWebhook(t, inboundText(pnid, '573101110003', 'Nadie me contesta', { at: Date.now() - 45 * 60_000 })).expect(200);
      const reports = t.app.get(ReportsService);
      await reports.alertSlaBreaches();
      await reports.alertSlaBreaches();
      const alerts = (await team.owner.api.get('/api/v1/notifications').expect(200)).body.items.filter((n: { title: string }) => /sin primera respuesta/i.test(n.title));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].title).toMatch(/\+573101110003|573101110003/);
    });
  });
});
