import { createHmac, randomUUID } from 'node:crypto';
import type { as } from './test-app.js';
import { META_APP_SECRET, type TestApp } from './test-app.js';

type Api = ReturnType<typeof as>;

export const newPhoneId = () => `PN-${randomUUID().slice(0, 8)}`;
export const newWamid = () => `wamid.${randomUUID()}`;

export const connectChannel = (api: Api, phoneNumberId = newPhoneId(), code = 'codigo-ok') =>
  api.post('/api/v1/whatsapp/channels', { code, wabaId: `WABA-${phoneNumberId}`, phoneNumberId });

/** Webhook firmado igual que Meta. */
export function sendWebhook(t: TestApp, payload: object, secret = META_APP_SECRET) {
  const raw = JSON.stringify(payload);
  const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  return t.http().post('/api/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', signature).send(raw);
}

const envelope = (value: object) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value }] }] });

export function inboundText(phoneNumberId: string, from: string, text: string, opts: { id?: string; at?: number; name?: string } = {}) {
  return envelope({
    metadata: { phone_number_id: phoneNumberId },
    contacts: [{ wa_id: from, profile: { name: opts.name ?? 'Carlos Ruiz' } }],
    messages: [{ id: opts.id ?? newWamid(), from, timestamp: String(Math.floor((opts.at ?? Date.now()) / 1000)), type: 'text', text: { body: text } }],
  });
}

export function inboundMedia(phoneNumberId: string, from: string, type: 'image' | 'audio' | 'document', mediaId: string, mimeType: string) {
  return envelope({
    metadata: { phone_number_id: phoneNumberId },
    contacts: [{ wa_id: from, profile: { name: 'Cliente' } }],
    messages: [{ id: newWamid(), from, timestamp: String(Math.floor(Date.now() / 1000)), type, [type]: { id: mediaId, mime_type: mimeType } }],
  });
}

export const statusUpdate = (phoneNumberId: string, id: string, status: string) =>
  envelope({ metadata: { phone_number_id: phoneNumberId }, statuses: [{ id, status, timestamp: '1760000000', recipient_id: '57' }] });

export const templateStatus = (wabaId: string, templateId: string, event: string, reason?: string) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: wabaId, changes: [{ field: 'message_template_status_update', value: { event, message_template_id: templateId, reason } }] }],
});

export async function conversationOf(api: Api, phone: string) {
  return (await api.get('/api/v1/conversations?limit=100').expect(200)).body.find((c: { contact: { phone: string } }) => c.contact.phone === phone);
}
