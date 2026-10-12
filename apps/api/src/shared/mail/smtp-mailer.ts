import nodemailer, { type Transporter } from 'nodemailer';
import type { Mailer, MailMessage } from './mailer.js';

export interface SmtpOptions { host: string; port: number; secure?: boolean; user?: string; pass?: string }

/**
 * Local: Mailpit sin autenticación. Producción: proveedor transaccional (SES, Resend, Postmark, Brevo).
 * Con usuario y en 587 se exige STARTTLS: la contraseña nunca viaja en claro.
 */
export function transportOptions({ host, port, secure = false, user, pass }: SmtpOptions) {
  return { host, port, secure, requireTLS: !secure && Boolean(user), ...(user ? { auth: { user, pass } } : {}) };
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(options: SmtpOptions & { from: string }) {
    this.transport = nodemailer.createTransport(transportOptions(options));
    this.from = options.from;
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}
