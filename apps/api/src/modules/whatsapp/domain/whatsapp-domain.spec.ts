import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryAttemptStore } from '../../identity/infrastructure/in-memory-attempt-store.js';
import { classifyMetaError } from './meta-errors.js';
import { canAdvanceStatus } from './message-status.js';
import { PhoneThrottle, ThrottledError } from './phone-throttle.js';
import { parseWebhook } from './webhook-payload.js';
import { verifyMetaSignature } from './webhook-signature.js';
import { windowState } from './window.js';

describe('Firma X-Hub-Signature-256 (E04-S02)', () => {
  const body = Buffer.from('{"entry":[]}');
  const sign = (secret: string, raw = body) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

  it('acepta la firma correcta', () => expect(verifyMetaSignature(body, sign('app-secret'), 'app-secret')).toBe(true));
  it.each([
    ['otro secreto', sign('otro')],
    ['body alterado', sign('app-secret', Buffer.from('{"entry":[1]}'))],
    ['sin prefijo', sign('app-secret').slice(7)],
    ['vacía', ''],
    ['basura', 'sha256=zz'],
  ])('rechaza %s', (_, header) => expect(verifyMetaSignature(body, header, 'app-secret')).toBe(false));
});

describe('parseWebhook (E04-S02)', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'PN1', display_phone_number: '573001112233' },
          contacts: [{ wa_id: '573009998877', profile: { name: 'Ana Gómez' } }],
          messages: [
            { id: 'wamid.A', from: '573009998877', timestamp: '1760000000', type: 'text', text: { body: 'Hola, ¿precio?' } },
            { id: 'wamid.B', from: '573009998877', timestamp: '1760000005', type: 'image', image: { id: 'MEDIA1', mime_type: 'image/jpeg', caption: 'foto' } },
          ],
          statuses: [{ id: 'wamid.OUT', status: 'delivered', timestamp: '1760000010', recipient_id: '573009998877' }],
        },
      }],
    }],
  };

  it('normaliza mensajes, perfil y estados por número', () => {
    const [batch] = parseWebhook(payload);
    expect(batch!.phoneNumberId).toBe('PN1');
    expect(batch!.messages).toEqual([
      { waMessageId: 'wamid.A', from: '+573009998877', profileName: 'Ana Gómez', at: new Date(1760000000_000), type: 'text', body: 'Hola, ¿precio?', media: null },
      { waMessageId: 'wamid.B', from: '+573009998877', profileName: 'Ana Gómez', at: new Date(1760000005_000), type: 'image', body: 'foto', media: { id: 'MEDIA1', mimeType: 'image/jpeg' } },
    ]);
    expect(batch!.statuses).toEqual([{ waMessageId: 'wamid.OUT', status: 'delivered', at: new Date(1760000010_000), error: null }]);
  });

  it('ignora lo que no es de WhatsApp o no trae datos', () => {
    expect(parseWebhook({ object: 'page', entry: [] })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
    expect(parseWebhook({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'account_update', value: {} }] }] })).toEqual([]);
  });
});

describe('Ventana de 24 horas (E04-S04)', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  it('abierta con tiempo restante', () => {
    expect(windowState(new Date('2026-10-06T10:00:00Z'), now)).toEqual({ open: true, closesAt: new Date('2026-10-07T10:00:00Z'), remainingMs: 22 * 3600_000 });
  });
  it('cerrada pasadas 24 h', () => expect(windowState(new Date('2026-10-05T11:59:00Z'), now).open).toBe(false));
  it('cerrada si el cliente nunca escribió', () => expect(windowState(null, now)).toEqual({ open: false, closesAt: null, remainingMs: 0 }));
});

describe('Errores de Meta traducidos (E04-S03)', () => {
  it.each([
    [131047, false, /24 horas/],
    [131026, false, /no se pudo entregar/i],
    [130429, true, /límite de envío/i],
    [131056, true, /demasiados mensajes/i],
    [190, false, /reconectar/i],
    [131000, true, /temporal/i],
  ])('código %i → reintentable=%s', (code, retryable, message) => {
    const e = classifyMetaError({ code, message: 'raw' }, 200);
    expect(e.retryable).toBe(retryable);
    expect(e.friendly).toMatch(message);
  });
  it('HTTP 429/5xx sin código conocido se reintenta', () => {
    expect(classifyMetaError({ code: 999, message: 'x' }, 503).retryable).toBe(true);
    expect(classifyMetaError({ code: 999, message: 'x' }, 429).retryable).toBe(true);
    expect(classifyMetaError({ code: 999, message: 'x' }, 400).retryable).toBe(false);
  });
  it('token vencido marca el canal para reconectar', () => expect(classifyMetaError({ code: 190, message: 'x' }, 401).disconnect).toBe(true));
});

describe('Estados de mensaje solo avanzan (E04-S03)', () => {
  it.each([
    ['pending', 'sent', true], ['sent', 'delivered', true], ['delivered', 'read', true], ['sent', 'read', true],
    ['read', 'delivered', false], ['delivered', 'sent', false], ['read', 'read', false],
    ['sent', 'failed', true], ['read', 'failed', false], ['failed', 'delivered', false],
  ] as const)('%s → %s = %s', (from, to, ok) => expect(canAdvanceStatus(from, to)).toBe(ok));
});

describe('Ritmo de envío por número (E15-S06)', () => {
  it('deja pasar hasta el límite por segundo y luego pide esperar', async () => {
    let now = 0;
    const throttle = new PhoneThrottle(new InMemoryAttemptStore(() => now), 3, () => now);
    for (let i = 0; i < 3; i++) await throttle.acquire('PN1');
    await expect(throttle.acquire('PN1')).rejects.toBeInstanceOf(ThrottledError);
    await throttle.acquire('PN2'); // otro número tiene su propio cupo
    now += 1001;
    await expect(throttle.acquire('PN1')).resolves.toBeUndefined();
  });
});
