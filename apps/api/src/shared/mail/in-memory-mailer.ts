import type { Mailer, MailMessage } from './mailer.js';

export class InMemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  /** Primer enlace http(s) del último correo enviado a `to`. */
  lastLinkTo(to: string): string {
    const message = this.sent.findLast((m) => m.to === to);
    const link = message?.text.match(/https?:\/\/\S+/)?.[0];
    if (!link) throw new Error(`No hay correos con enlace para ${to}`);
    return link;
  }
}
