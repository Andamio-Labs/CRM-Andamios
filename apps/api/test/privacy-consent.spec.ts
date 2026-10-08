import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTeam, createTestApp, type TestApp } from './support/test-app.js';

/** E13-S02 — Base legal, finalidad y fecha del consentimiento de cada contacto (Ley 1581 de 2012). */
describe('Consentimiento y finalidad por contacto (E13-S02)', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  const newContact = async (name: string, phone?: string) =>
    (await team.owner.api.post('/api/v1/contacts', { name, phone, allowDuplicate: true }).expect(201)).body.id as string;

  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Privacidad SAS');
  });
  afterAll(() => t.close());

  it('registra base legal, finalidades, canal y fecha; el estado actual sale del último registro de cada finalidad', async () => {
    const id = await newContact('Titular uno');
    const granted = (await team.seller.api.post(`/api/v1/contacts/${id}/consents`, {
      legalBasis: 'consent', purposes: ['sales', 'marketing'], granted: true, channel: 'web_form', evidence: 'Formulario de la landing, casilla marcada',
    }).expect(201)).body;
    expect(granted).toMatchObject({ legalBasis: 'consent', purposes: ['sales', 'marketing'], granted: true, channel: 'web_form', recordedBy: team.seller.userId });
    expect(Date.parse(granted.recordedAt)).not.toBeNaN();

    await team.owner.api.post(`/api/v1/contacts/${id}/consents`, { legalBasis: 'consent', purposes: ['marketing'], granted: false, channel: 'phone' }).expect(201);

    const { current, history } = (await team.owner.api.get(`/api/v1/contacts/${id}/consents`).expect(200)).body;
    expect(current.sales).toMatchObject({ granted: true, legalBasis: 'consent', channel: 'web_form' });
    expect(current.marketing).toMatchObject({ granted: false, channel: 'phone' });
    expect(current.billing).toBeUndefined();
    expect(history).toHaveLength(2);
    expect(history[0].granted).toBe(false);
  });

  it('valida base legal, finalidades y canal', async () => {
    const id = await newContact('Titular dos');
    const post = (body: object) => team.owner.api.post(`/api/v1/contacts/${id}/consents`, body);
    await post({ legalBasis: 'porque_si', purposes: ['sales'], granted: true, channel: 'phone' }).expect(400);
    await post({ legalBasis: 'consent', purposes: [], granted: true, channel: 'phone' }).expect(400);
    await post({ legalBasis: 'consent', purposes: ['vender_datos'], granted: true, channel: 'phone' }).expect(400);
    await post({ legalBasis: 'contract', purposes: ['billing'], granted: true }).expect(400);
    await post({ legalBasis: 'contract', purposes: ['billing'], granted: true, channel: 'in_person' }).expect(201);
  });

  it('el historial es append-only: la app no puede editarlo ni borrarlo', async () => {
    const id = await newContact('Titular tres');
    await team.owner.api.post(`/api/v1/contacts/${id}/consents`, { legalBasis: 'consent', purposes: ['sales'], granted: true, channel: 'phone' }).expect(201);
    const { rows: [privs] } = await t.owner.query<{ upd: boolean; del: boolean }>(
      `SELECT has_table_privilege('beecrm_app', 'contact_consents', 'UPDATE') AS upd, has_table_privilege('beecrm_app', 'contact_consents', 'DELETE') AS del`,
    );
    expect(privs).toEqual({ upd: false, del: false });
  });

  it('el consentimiento manual de WhatsApp (E04-S09) también queda en el historial', async () => {
    const id = await newContact('Titular cuatro');
    await team.owner.api.patch(`/api/v1/contacts/${id}/consent`, { optIn: true, source: 'formulario_web' }).expect(200);
    await team.owner.api.patch(`/api/v1/contacts/${id}/consent`, { optIn: false, source: 'formulario_web' }).expect(200);
    const { history } = (await team.owner.api.get(`/api/v1/contacts/${id}/consents`).expect(200)).body;
    expect(history.map((h: { granted: boolean; channel: string; purposes: string[] }) => [h.granted, h.channel, h.purposes])).toEqual([
      [false, 'whatsapp', ['marketing']],
      [true, 'whatsapp', ['marketing']],
    ]);
  });

  it('al fusionar contactos el historial del duplicado pasa al que se conserva', async () => {
    const keep = await newContact('Titular cinco', '3001112233');
    const dup = await newContact('Titular cinco bis', '3001112233');
    await team.owner.api.post(`/api/v1/contacts/${dup}/consents`, { legalBasis: 'consent', purposes: ['marketing'], granted: true, channel: 'web_form', evidence: 'casilla' }).expect(201);
    await team.owner.api.post(`/api/v1/contacts/${keep}/merge`, { duplicateId: dup }).expect(200);
    const { current, history } = (await team.owner.api.get(`/api/v1/contacts/${keep}/consents`).expect(200)).body;
    expect(current.marketing).toMatchObject({ granted: true, evidence: 'casilla' });
    expect(history).toHaveLength(1);
  });

  it('otra empresa no ve ni registra consentimientos de mis contactos', async () => {
    const id = await newContact('Titular seis');
    const other = (await createTeam(t, 'Otra de privacidad')).owner.api;
    await other.get(`/api/v1/contacts/${id}/consents`).expect(404);
    await other.post(`/api/v1/contacts/${id}/consents`, { legalBasis: 'consent', purposes: ['sales'], granted: true, channel: 'phone' }).expect(404);
  });
});
