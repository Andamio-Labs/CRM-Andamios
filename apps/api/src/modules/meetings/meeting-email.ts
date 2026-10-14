import type { MailMessage } from '../../shared/mail/mailer.js';

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** E12-S03 — Invitación para personas de fuera del equipo: no tienen cuenta, solo el enlace de la sala. */
export function meetingInvitationEmail(data: {
  to: string;
  title: string;
  organizer: string;
  organization: string;
  when: string;
  joinUrl: string;
  agenda: string | null;
}): MailMessage {
  const intro = `${data.organizer} (${data.organization}) te invitó a la reunión "${data.title}".`;
  return {
    to: data.to,
    subject: `Invitación: ${data.title} — ${data.when}`,
    text: `${intro}\n\nCuándo: ${data.when}\nEntrar: ${data.joinUrl}${data.agenda ? `\n\nTemas:\n${data.agenda}` : ''}`,
    html: `<!doctype html><html lang="es"><body style="font-family:system-ui,sans-serif;color:#1f2933;max-width:520px;margin:auto;padding:24px">
<p>${escape(intro)}</p>
<p><strong>Cuándo:</strong> ${escape(data.when)}</p>
${data.agenda ? `<p><strong>Temas:</strong><br>${escape(data.agenda).replace(/\n/g, '<br>')}</p>` : ''}
<p><a href="${escape(data.joinUrl)}" style="display:inline-block;background:#f5b700;color:#1f2933;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Entrar a la reunión</a></p>
<p style="font-size:12px;color:#616e7c">Si el botón no funciona, copia este enlace: ${escape(data.joinUrl)}</p></body></html>`,
  };
}

export function meetingCanceledEmail(data: { to: string; title: string; organizer: string; when: string }): MailMessage {
  const text = `${data.organizer} canceló la reunión "${data.title}" del ${data.when}.`;
  return {
    to: data.to,
    subject: `Cancelada: ${data.title} — ${data.when}`,
    text,
    html: `<!doctype html><html lang="es"><body style="font-family:system-ui,sans-serif;color:#1f2933;max-width:520px;margin:auto;padding:24px"><p>${escape(text)}</p></body></html>`,
  };
}
