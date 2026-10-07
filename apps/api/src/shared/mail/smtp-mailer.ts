import nodemailer, { type Transporter } from 'nodemailer';
import type { Mailer, MailMessage } from './mailer.js';

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(options: { host: string; port: number; from: string }) {
    this.transport = nodemailer.createTransport({ host: options.host, port: options.port, secure: false });
    this.from = options.from;
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}
