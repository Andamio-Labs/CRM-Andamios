import type { MailMessage } from '../../../shared/mail/mailer.js';

interface Recipient {
  name: string;
  email: string;
}

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, body: string, cta: { label: string; url: string }) {
  return `<!doctype html><html lang="es"><body style="font-family:system-ui,sans-serif;color:#1f2933;max-width:520px;margin:auto;padding:24px">
<h1 style="font-size:20px">${escape(title)}</h1>${body}
<p><a href="${escape(cta.url)}" style="display:inline-block;background:#f5b700;color:#1f2933;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escape(cta.label)}</a></p>
<p style="font-size:12px;color:#616e7c">Si no fuiste tú, ignora este correo.</p></body></html>`;
}

export function verifyEmailEmail(user: Recipient, url: string): MailMessage {
  return {
    to: user.email,
    subject: 'Confirma tu correo en BeeCRM',
    text: `Hola ${user.name}, confirma tu correo para empezar a usar BeeCRM: ${url}`,
    html: layout(`Hola ${user.name}`, '<p>Confirma tu correo para empezar a usar BeeCRM.</p>', { label: 'Confirmar correo', url }),
  };
}

export function resetPasswordEmail(user: Recipient, url: string): MailMessage {
  return {
    to: user.email,
    subject: 'Restablece tu contraseña de BeeCRM',
    text: `Hola ${user.name}, para crear una contraseña nueva entra aquí (vence en 1 hora): ${url}`,
    html: layout(`Hola ${user.name}`, '<p>Para crear una contraseña nueva usa este enlace. Vence en 1 hora.</p>', {
      label: 'Restablecer contraseña',
      url,
    }),
  };
}
