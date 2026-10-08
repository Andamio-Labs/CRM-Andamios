import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type as, createTeam, createTestApp, type TestApp } from './support/test-app.js';
import {
  connectChannel, conversationOf, inboundMedia, inboundText, newPhoneId, sendWebhook, templateStatus,
} from './support/whatsapp.js';

type Api = ReturnType<typeof as>;
let seq = 0;
const phone = () => `5732${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

/** Sprint 4 — E04-S05..S10 y E02-S05. */
describe('Bandeja (Sprint 4)', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  let pnid: string;
  let channelId: string;

  async function conversation(from = phone(), text = 'Hola') {
    await sendWebhook(t, inboundText(pnid, from, text)).expect(200);
    return conversationOf(team.owner.api, `+${from}`);
  }
  const thread = async (api: Api, id: string) => (await api.get(`/api/v1/conversations/${id}/messages`).expect(200)).body;

  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Clínica Bandeja');
    pnid = newPhoneId();
    channelId = (await connectChannel(team.owner.api, pnid).expect(201)).body.id;
  });
  afterAll(() => t.close());

  describe('Plantillas (E04-S05)', () => {
    const tpl = { name: 'recordatorio_cita', language: 'es_CO', category: 'UTILITY', body: 'Hola {{1}}, tu cita es el {{2}}.', examples: ['Ana', '7 de octubre'] };

    it('se crean, van a aprobación y Meta informa el estado por webhook', async () => {
      const created = (await team.admin.api.post('/api/v1/whatsapp/templates', { ...tpl, channelId }).expect(201)).body;
      expect(created).toMatchObject({ status: 'PENDING', category: 'UTILITY', metaTemplateId: expect.any(String) });
      await team.admin.api.post('/api/v1/whatsapp/templates', { ...tpl, channelId, body: 'Hola {{1}} {{3}}' }).expect(400);
      await team.seller.api.post('/api/v1/whatsapp/templates', { ...tpl, channelId, name: 'x' }).expect(403);

      await sendWebhook(t, templateStatus(`WABA-${pnid}`, created.metaTemplateId, 'APPROVED')).expect(200);
      const list = (await team.seller.api.get('/api/v1/whatsapp/templates').expect(200)).body;
      expect(list.find((x: { id: string }) => x.id === created.id).status).toBe('APPROVED');
    });

    it('se envían solo aprobadas, con sus variables', async () => {
      const pending = (await team.owner.api.post('/api/v1/whatsapp/templates', { ...tpl, channelId, name: 'pendiente' }).expect(201)).body;
      const conv = await conversation();
      const blocked = await team.owner.api.post(`/api/v1/conversations/${conv.id}/messages`, { type: 'template', templateId: pending.id, variables: ['Ana', 'hoy'] }).expect(409);
      expect(blocked.body.code).toBe('TEMPLATE_NOT_APPROVED');

      await sendWebhook(t, templateStatus(`WABA-${pnid}`, pending.metaTemplateId, 'APPROVED')).expect(200);
      await team.owner.api.post(`/api/v1/conversations/${conv.id}/messages`, { type: 'template', templateId: pending.id, variables: ['Ana'] }).expect(400);
      await team.owner.api.post(`/api/v1/conversations/${conv.id}/messages`, { type: 'template', templateId: pending.id, variables: ['Ana', '7 de octubre'] }).expect(202);
      expect(t.whatsapp.sent.at(-1)!.payload).toEqual({
        type: 'template', name: 'pendiente', language: 'es_CO',
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: '7 de octubre' }] }],
      });
      const out = (await thread(team.owner.api, conv.id)).at(-1);
      expect(out.body).toBe('Hola Ana, tu cita es el 7 de octubre.');
    });

    it('un rechazo guarda el motivo', async () => {
      const created = (await team.owner.api.post('/api/v1/whatsapp/templates', { ...tpl, channelId, name: 'promo_rechazada', category: 'MARKETING' }).expect(201)).body;
      await sendWebhook(t, templateStatus(`WABA-${pnid}`, created.metaTemplateId, 'REJECTED', 'INVALID_FORMAT')).expect(200);
      const row = (await team.owner.api.get('/api/v1/whatsapp/templates').expect(200)).body.find((x: { id: string }) => x.id === created.id);
      expect(row).toMatchObject({ status: 'REJECTED', rejectionReason: 'INVALID_FORMAT' });
    });
  });

  describe('Multimedia (E04-S06)', () => {
    it('una nota de voz se descarga de Meta, se guarda y se reproduce con URL firmada', async () => {
      t.whatsapp.setMedia('MEDIA-AUDIO', { mimeType: 'audio/ogg', body: Buffer.from('OggS-audio') });
      const from = phone();
      await sendWebhook(t, inboundMedia(pnid, from, 'audio', 'MEDIA-AUDIO', 'audio/ogg')).expect(200);
      const conv = await conversationOf(team.owner.api, `+${from}`);
      const [msg] = await thread(team.owner.api, conv.id);
      expect(msg.media).toMatchObject({ status: 'ready', mimeType: 'audio/ogg', url: expect.stringContaining('/api/media/') });

      const url = new URL(msg.media.url);
      const file = await t.http().get(`${url.pathname}${url.search}`).expect(200);
      expect(file.headers['content-type']).toBe('audio/ogg');
      expect(file.headers['content-security-policy']).toContain('sandbox');
      expect(Buffer.from(file.body).toString()).toBe('OggS-audio');

      await t.http().get(`${url.pathname}?expires=${url.searchParams.get('expires')}&signature=falsa`).expect(403);
    });

    it('un SVG se sirve como descarga, nunca en línea', async () => {
      t.whatsapp.setMedia('MEDIA-SVG', { mimeType: 'image/svg+xml', body: Buffer.from('<svg onload="alert(1)"/>') });
      const from = phone();
      await sendWebhook(t, inboundMedia(pnid, from, 'document', 'MEDIA-SVG', 'image/svg+xml')).expect(200);
      const [msg] = await thread(team.owner.api, (await conversationOf(team.owner.api, `+${from}`)).id);
      const url = new URL(msg.media.url);
      const file = await t.http().get(`${url.pathname}${url.search}`).expect(200);
      expect(file.headers['content-disposition']).toMatch(/^attachment/);
      expect(file.headers['content-type']).toBe('application/octet-stream');
    });

    it('un archivo más grande que el límite no se guarda y queda marcado', async () => {
      t.whatsapp.setMedia('MEDIA-BIG', { mimeType: 'image/jpeg', body: Buffer.from('x'), fileSize: 6 * 1024 * 1024 });
      const from = phone();
      await sendWebhook(t, inboundMedia(pnid, from, 'image', 'MEDIA-BIG', 'image/jpeg')).expect(200);
      const [msg] = await thread(team.owner.api, (await conversationOf(team.owner.api, `+${from}`)).id);
      expect(msg.media).toMatchObject({ status: 'too_large' });
      expect(msg.media.url).toBeUndefined();
    });
  });

  describe('Filtros y asignación (E04-S07)', () => {
    it('no leídas, mías y sin asignar, con contadores', async () => {
      const a = await conversation();
      const b = await conversation();
      await team.admin.api.patch(`/api/v1/conversations/${a.id}/assignment`, { userId: team.seller.userId }).expect(200);

      const ids = async (api: Api, filter: string) => (await api.get(`/api/v1/conversations?filter=${filter}`).expect(200)).body.map((c: { id: string }) => c.id);
      expect(await ids(team.seller.api, 'mine')).toContain(a.id);
      expect(await ids(team.seller.api, 'mine')).not.toContain(b.id);
      expect(await ids(team.owner.api, 'unassigned')).toContain(b.id);
      expect(await ids(team.owner.api, 'unassigned')).not.toContain(a.id);
      expect(await ids(team.owner.api, 'unread')).toEqual(expect.arrayContaining([a.id, b.id]));

      const counts = (await team.seller.api.get('/api/v1/conversations/counts').expect(200)).body;
      expect(counts.mine).toBeGreaterThanOrEqual(1);
      expect(counts.unread).toBeGreaterThanOrEqual(2);
      expect(counts.unassigned).toBeGreaterThanOrEqual(1);
    });

    it('el vendedor toma una sin asignar y transfiere la suya, pero no la de otro', async () => {
      const free = await conversation();
      await team.seller.api.patch(`/api/v1/conversations/${free.id}/assignment`, { userId: team.seller.userId }).expect(200);
      await team.seller.api.patch(`/api/v1/conversations/${free.id}/assignment`, { userId: team.admin.userId }).expect(200); // transfiere la suya
      await team.seller.api.patch(`/api/v1/conversations/${free.id}/assignment`, { userId: team.seller.userId }).expect(403); // ya no es suya
      await team.owner.api.patch(`/api/v1/conversations/${free.id}/assignment`, { userId: 'usuario-ajeno' }).expect(400);
    });

    it('con "solo lo asignado", el vendedor ve las conversaciones asignadas a él', async () => {
      const conv = await conversation();
      await team.owner.api.patch('/api/v1/tenant/settings', { sellersSeeOnlyAssigned: true }).expect(200);
      await team.seller.api.get(`/api/v1/conversations/${conv.id}`).expect(404);
      await team.owner.api.patch(`/api/v1/conversations/${conv.id}/assignment`, { userId: team.seller.userId }).expect(200);
      await team.seller.api.get(`/api/v1/conversations/${conv.id}`).expect(200);
      await team.owner.api.patch('/api/v1/tenant/settings', { sellersSeeOnlyAssigned: false }).expect(200);
    });
  });

  describe('Notas internas y respuestas rápidas (E04-S08)', () => {
    it('una nota interna queda en el hilo y nunca se envía al cliente, aun con la ventana cerrada', async () => {
      const conv = await conversation();
      await t.owner.query(`UPDATE conversations SET last_inbound_at = now() - interval '2 days' WHERE id = $1`, [conv.id]);
      const before = t.whatsapp.sent.length;
      await team.seller.api.post(`/api/v1/conversations/${conv.id}/messages`, { type: 'note', text: 'Cliente pidió descuento, consultar a gerencia' }).expect(202);
      expect(t.whatsapp.sent.length).toBe(before);
      expect((await thread(team.owner.api, conv.id)).at(-1)).toMatchObject({ direction: 'note', status: 'internal', body: 'Cliente pidió descuento, consultar a gerencia' });
    });

    it('respuestas rápidas con atajo único', async () => {
      await team.admin.api.post('/api/v1/quick-replies', { shortcut: 'saludo', body: 'Hola {{contact.name}}, soy {{user.name}}. ¿En qué te ayudo?' }).expect(201);
      await team.admin.api.post('/api/v1/quick-replies', { shortcut: 'saludo', body: 'otro' }).expect(409);
      await team.admin.api.post('/api/v1/quick-replies', { shortcut: 'Con Espacio', body: 'x' }).expect(400);
      await team.seller.api.post('/api/v1/quick-replies', { shortcut: 'mio', body: 'x' }).expect(403);
      const list = (await team.seller.api.get('/api/v1/quick-replies').expect(200)).body;
      expect(list.map((q: { shortcut: string }) => q.shortcut)).toContain('saludo');
    });
  });

  describe('Consentimiento (E04-S09)', () => {
    it('el primer mensaje registra el consentimiento con origen y fecha; BAJA bloquea plantillas; ALTA las reactiva', async () => {
      const from = phone();
      const conv = await conversation(from);
      let contact = (await team.owner.api.get(`/api/v1/contacts/${conv.contact.id}`).expect(200)).body;
      expect(contact).toMatchObject({ whatsappOptInSource: 'mensaje_entrante', whatsappOptOutAt: null });
      expect(contact.whatsappOptInAt).toBeTruthy();

      const tplId = (await team.owner.api.post('/api/v1/whatsapp/templates', { channelId, name: `aviso_${seq++}`, language: 'es_CO', category: 'MARKETING', body: 'Promo', examples: [] }).expect(201)).body.id;
      await t.owner.query(`UPDATE whatsapp_templates SET status = 'APPROVED' WHERE id = $1`, [tplId]);

      await sendWebhook(t, inboundText(pnid, from, 'BAJA')).expect(200);
      contact = (await team.owner.api.get(`/api/v1/contacts/${conv.contact.id}`).expect(200)).body;
      expect(contact.whatsappOptOutAt).toBeTruthy();
      expect(t.whatsapp.sent.at(-1)).toMatchObject({ to: `+${from}`, payload: { type: 'text', text: expect.stringMatching(/no te enviaremos/i) } });
      const res = await team.owner.api.post(`/api/v1/conversations/${conv.id}/messages`, { type: 'template', templateId: tplId, variables: [] }).expect(409);
      expect(res.body.code).toBe('CONTACT_OPTED_OUT');

      await sendWebhook(t, inboundText(pnid, from, 'ALTA')).expect(200);
      await team.owner.api.post(`/api/v1/conversations/${conv.id}/messages`, { type: 'template', templateId: tplId, variables: [] }).expect(202);

      // E13-S02 — Cada paso queda en el historial de consentimiento, por WhatsApp.
      const { history } = (await team.owner.api.get(`/api/v1/contacts/${conv.contact.id}/consents`).expect(200)).body;
      expect(history.map((h: { granted: boolean; purposes: string[]; channel: string }) => [h.granted, h.purposes, h.channel])).toEqual([
        [true, ['marketing'], 'whatsapp'],
        [false, ['marketing'], 'whatsapp'],
        [true, ['customer_service'], 'whatsapp'],
      ]);
    });

    it('el consentimiento también se registra a mano con su origen', async () => {
      const contact = (await team.owner.api.post('/api/v1/contacts', { name: 'Formulario', phone: '3001112299' }).expect(201)).body;
      const res = await team.owner.api.patch(`/api/v1/contacts/${contact.id}/consent`, { optIn: true, source: 'formulario_web' }).expect(200);
      expect(res.body).toMatchObject({ whatsappOptInSource: 'formulario_web', whatsappOptOutAt: null });
    });
  });

  describe('Fuera de horario (E04-S10)', () => {
    it('responde automáticamente una vez por conversación, y vuelve a hacerlo después de que responda una persona', async () => {
      const closed = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
      await team.owner.api.patch('/api/v1/tenant/settings', { businessHours: closed, outOfHoursEnabled: true, outOfHoursMessage: 'Abrimos a las 8. Te escribimos pronto.' }).expect(200);
      const from = phone();
      const autoReplies = () => t.whatsapp.sent.filter((s) => s.to === `+${from}` && s.payload.type === 'text' && s.payload.text.startsWith('Abrimos a las 8')).length;

      const conv = await conversation(from, 'Hola, ¿están?');
      expect(autoReplies()).toBe(1);
      await sendWebhook(t, inboundText(pnid, from, '¿Hola?')).expect(200);
      expect(autoReplies()).toBe(1);

      await team.owner.api.post(`/api/v1/conversations/${conv.id}/messages`, { type: 'text', text: 'Hola, ya te atiendo' }).expect(202);
      await sendWebhook(t, inboundText(pnid, from, 'Gracias')).expect(200);
      expect(autoReplies()).toBe(2);

      await team.owner.api.patch('/api/v1/tenant/settings', { outOfHoursEnabled: false }).expect(200);
    });
  });

  describe('Línea de tiempo del contacto (E02-S05)', () => {
    it('mezcla mensajes, notas y cambios de etapa en orden cronológico, con paginación', async () => {
      const conv = await conversation(phone(), 'Primer mensaje');
      await team.owner.api.post(`/api/v1/conversations/${conv.id}/messages`, { type: 'note', text: 'Nota interna' }).expect(202);
      const pipeline = (await team.owner.api.get('/api/v1/pipelines').expect(200)).body[0];
      const deal = (await t.owner.query(`SELECT id FROM deals WHERE contact_id = $1`, [conv.contact.id])).rows[0];
      await team.owner.api.post(`/api/v1/deals/${deal.id}/move`, { stageId: pipeline.stages[1].id }).expect(200);

      const page1 = (await team.owner.api.get(`/api/v1/contacts/${conv.contact.id}/timeline?limit=2`).expect(200)).body;
      const page2 = (await team.owner.api.get(`/api/v1/contacts/${conv.contact.id}/timeline?limit=2&cursor=${page1.nextCursor}`).expect(200)).body;
      const items = [...page1.items, ...page2.items];
      expect(items.map((i: { kind: string; summary: string }) => `${i.kind}:${i.summary}`)).toEqual([
        'deal:Cambió de etapa',
        'note:Nota interna',
        'deal:Negocio creado',
        'message:Primer mensaje',
      ]);
      expect(page2.nextCursor).toBeNull();
    });

    it('respeta la visibilidad: otro tenant no ve la línea de tiempo', async () => {
      const conv = await conversation();
      const other = (await createTeam(t, 'Ajena')).owner.api;
      await other.get(`/api/v1/contacts/${conv.contact.id}/timeline`).expect(404);
    });
  });
});
