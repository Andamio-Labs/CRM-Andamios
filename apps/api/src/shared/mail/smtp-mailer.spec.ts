import { describe, expect, it } from 'vitest';
import { transportOptions } from './smtp-mailer.js';

/** Proveedor transaccional (SES, Resend, Postmark, Brevo): SMTP con usuario, contraseña y TLS. */
describe('Opciones del transporte SMTP', () => {
  it('Mailpit en desarrollo: sin autenticación ni TLS', () => {
    expect(transportOptions({ host: 'mailpit', port: 1025 })).toEqual({ host: 'mailpit', port: 1025, secure: false, requireTLS: false });
  });

  it('proveedor en el puerto 587: autentica y exige STARTTLS', () => {
    expect(transportOptions({ host: 'email-smtp.us-east-1.amazonaws.com', port: 587, user: 'AKIA', pass: 'secreto' }))
      .toEqual({ host: 'email-smtp.us-east-1.amazonaws.com', port: 587, secure: false, requireTLS: true, auth: { user: 'AKIA', pass: 'secreto' } });
  });

  it('proveedor en el puerto 465: TLS directo', () => {
    expect(transportOptions({ host: 'smtp.resend.com', port: 465, secure: true, user: 'resend', pass: 're_x' }))
      .toMatchObject({ secure: true, requireTLS: false, auth: { user: 'resend', pass: 're_x' } });
  });
});
