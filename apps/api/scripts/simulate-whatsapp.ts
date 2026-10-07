/**
 * Simula un mensaje entrante de WhatsApp en desarrollo (sin cuenta de Meta).
 * Firma el webhook igual que Meta (X-Hub-Signature-256) y lo envía a la API local.
 *
 *   node scripts/simulate-whatsapp.ts <phone_number_id> <telefono_cliente> "<texto>" ["Nombre"]
 *   node scripts/simulate-whatsapp.ts PN-local 573001234567 "Hola, ¿tienen cita mañana?" "Ana Gómez"
 *
 * El phone_number_id debe estar conectado en Configuración → WhatsApp (con WHATSAPP_API=local
 * cualquier código de conexión funciona).
 */
import { createHmac, randomUUID } from 'node:crypto';

const [phoneNumberId, from, text, name = 'Cliente de prueba'] = process.argv.slice(2);
if (!phoneNumberId || !from || !text) {
  console.error('Uso: node scripts/simulate-whatsapp.ts <phone_number_id> <telefono> "<texto>" ["Nombre"]');
  process.exit(1);
}

const body = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ field: 'messages', value: {
    metadata: { phone_number_id: phoneNumberId },
    contacts: [{ wa_id: from.replace(/^\+/, ''), profile: { name } }],
    messages: [{ id: `wamid.sim.${randomUUID()}`, from: from.replace(/^\+/, ''), timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
  } }] }],
});
const secret = process.env.META_APP_SECRET ?? 'dev-meta-app-secret';
const res = await fetch(`${process.env.API_URL ?? 'http://localhost:3000'}/api/webhooks/whatsapp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` },
  body,
});
console.log(`${res.status} ${await res.text()}`);
