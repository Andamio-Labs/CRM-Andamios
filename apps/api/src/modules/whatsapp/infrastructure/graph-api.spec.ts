import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphWhatsAppApi, MetaApiError } from './whatsapp-api.js';

/** El adaptador real contra un "Graph API" local: verifica rutas, headers y bodies exactos. */
describe('GraphWhatsAppApi', () => {
  let server: Server;
  let api: GraphWhatsAppApi;
  const calls: { method: string; url: string; auth?: string; body: unknown }[] = [];
  let reply: { status: number; body: unknown } = { status: 200, body: {} };

  beforeAll(async () => {
    server = createServer(async (req: IncomingMessage, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      calls.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined });
      res.writeHead(reply.status, { 'content-type': 'application/json' }).end(JSON.stringify(reply.body));
    });
    await new Promise<void>((r) => server.listen(0, r));
    api = new GraphWhatsAppApi({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, version: 'v23.0', appId: 'APP', appSecret: 'SECRET' });
  });
  afterAll(() => new Promise((r) => server.close(r)));

  it('intercambia el código de Embedded Signup por un token', async () => {
    reply = { status: 200, body: { access_token: 'EAAG123' } };
    expect(await api.exchangeCode('CODE')).toBe('EAAG123');
    expect(calls.at(-1)).toMatchObject({ method: 'GET', url: '/v23.0/oauth/access_token?client_id=APP&client_secret=SECRET&code=CODE' });
  });

  it('envía texto en el formato de la Cloud API, sin el + del número', async () => {
    reply = { status: 200, body: { messages: [{ id: 'wamid.OK' }] } };
    const res = await api.send('PN1', 'TOKEN', '+573001234567', { type: 'text', text: 'Hola' });
    expect(res.waMessageId).toBe('wamid.OK');
    expect(calls.at(-1)).toEqual({
      method: 'POST', url: '/v23.0/PN1/messages', auth: 'Bearer TOKEN',
      body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: '573001234567', type: 'text', text: { body: 'Hola', preview_url: false } },
    });
  });

  it('registra el número con PIN y suscribe la app a la WABA', async () => {
    reply = { status: 200, body: { success: true } };
    await api.registerPhone('PN1', '123456', 'TOKEN');
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: '/v23.0/PN1/register', body: { messaging_product: 'whatsapp', pin: '123456' } });
    await api.subscribeApp('WABA1', 'TOKEN');
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: '/v23.0/WABA1/subscribed_apps', auth: 'Bearer TOKEN' });
  });

  it('convierte el error de Meta en MetaApiError con código y status', async () => {
    reply = { status: 400, body: { error: { code: 131047, message: 'Re-engagement message' } } };
    const error = await api.send('PN1', 'T', '+57300', { type: 'text', text: 'x' }).catch((e) => e);
    expect(error).toBeInstanceOf(MetaApiError);
    expect(error).toMatchObject({ httpStatus: 400, error: { code: 131047 } });
  });

  it('no permite inyectar rutas con el id', async () => {
    reply = { status: 200, body: {} };
    await api.getPhone('../../me', 'T');
    expect(calls.at(-1)!.url.startsWith('/v23.0/..%2F..%2Fme?')).toBe(true);
  });
});
