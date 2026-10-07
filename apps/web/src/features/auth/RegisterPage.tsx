import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { Alert, AuthLayout, Button, Field } from '../../shared/ui/form';
import { LEGAL_REQUIRED, LegalConsent } from '../legal/legal';

const PASSWORD_MIN_LENGTH = 10;

export function RegisterPage() {
  return (
    <AuthLayout title={<>Crea tu cuenta en <span className="text-honey">BeeCRM</span></>} subtitle="Empieza a organizar tus clientes y negocios.">
      <RegisterForm />
      <p className="mt-6 text-center text-sm text-auth-muted">
        ¿Ya tienes cuenta?{' '}
        <Link to="/login" className="font-medium text-auth-text underline">
          Inicia sesión
        </Link>
      </p>
    </AuthLayout>
  );
}

/** E01-S01 — Registro de empresa + propietario. */
export function RegisterForm() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [passwordError, setPasswordError] = useState<string>();
  const [legalError, setLegalError] = useState<string>();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      companyName: String(form.get('companyName')),
      name: String(form.get('name')),
      email: String(form.get('email')),
      password: String(form.get('password')),
      acceptLegal: form.get('acceptLegal') === 'on',
    };
    setPasswordError(body.password.length < PASSWORD_MIN_LENGTH ? `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.` : undefined);
    setLegalError(body.acceptLegal ? undefined : LEGAL_REQUIRED);
    if (body.password.length < PASSWORD_MIN_LENGTH || !body.acceptLegal) return;
    setStatus('sending');
    try {
      const res = await fetch('/api/v1/registrations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      setStatus(res.ok ? 'sent' : 'error');
    } catch {
      setStatus('error');
    }
  }

  if (status === 'sent') {
    return (
      <Alert tone="success">
        ¡Listo! Revisa tu correo y confirma tu cuenta para empezar.
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Field auth label="Nombre de la empresa" name="companyName" required autoComplete="organization" placeholder="Nombre de tu empresa" />
      <Field auth label="Tu nombre" name="name" required autoComplete="name" placeholder="Cómo te llamas" />
      <Field auth label="Correo" name="email" type="email" required autoComplete="email" placeholder="Ingresa tu correo" />
      <Field auth label="Contraseña" name="password" type="password" required autoComplete="new-password" error={passwordError} placeholder="Mínimo 10 caracteres" />
      <LegalConsent error={legalError} />
      {status === 'error' && <Alert>No pudimos crear tu cuenta. Revisa los datos e inténtalo de nuevo.</Alert>}
      <Button type="submit" loading={status === 'sending'}>
        Crear cuenta
      </Button>
    </form>
  );
}
