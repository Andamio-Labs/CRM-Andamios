import type { MailMessage } from '../../../shared/mail/mailer.js';

const ROLE_NAMES = { admin: 'administrador', member: 'vendedor' } as const;

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function invitationEmail(data: {
  to: string;
  organization: string;
  inviter: string;
  role: keyof typeof ROLE_NAMES;
  url: string;
  days: number;
}): MailMessage {
  const role = ROLE_NAMES[data.role];
  const intro = `${data.inviter} te invitó a ${data.organization} en BeeCRM como ${role}.`;
  return {
    to: data.to,
    subject: `${data.inviter} te invitó a ${data.organization} en BeeCRM`,
    text: `${intro} Acepta la invitación aquí (vence en ${data.days} días): ${data.url}`,
    html: `<!doctype html><html lang="es"><body style="font-family:system-ui,sans-serif;color:#1f2933;max-width:520px;margin:auto;padding:24px">
<p>${escape(intro)}</p>
<p><a href="${escape(data.url)}" style="display:inline-block;background:#f5b700;color:#1f2933;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Aceptar invitación</a></p>
<p style="font-size:12px;color:#616e7c">La invitación vence en ${data.days} días.</p></body></html>`,
  };
}
