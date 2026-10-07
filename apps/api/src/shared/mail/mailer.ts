export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Puerto de correo saliente. Local: Mailpit (http://localhost:8025). Tests: memoria. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}
