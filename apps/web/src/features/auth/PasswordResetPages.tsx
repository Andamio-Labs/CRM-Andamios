import { Link, useSearch } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { authClient } from '../../shared/auth-client';
import { Alert, AuthLayout, Button, Field } from '../../shared/ui/form';

/** E01-S02 — Pide el enlace de recuperación (vence en 1 hora). */
export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    await authClient.requestPasswordReset({
      email: String(new FormData(event.currentTarget).get('email')),
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    setSent(true); // Misma respuesta exista o no la cuenta.
  }

  return (
    <AuthLayout title="Recupera tu contraseña" subtitle="Te enviaremos un enlace que vence en 1 hora.">
      {sent ? (
        <Alert tone="success">Si el correo está registrado, te llegará un enlace en unos minutos.</Alert>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field label="Correo" name="email" type="email" required autoComplete="email" />
          <Button type="submit" loading={loading}>
            Enviar enlace
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="text-muted underline">
          Volver a iniciar sesión
        </Link>
      </p>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { token, error: linkError } = useSearch({ strict: false }) as { token?: string; error?: string };
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setStatus('saving');
    const { error } = await authClient.resetPassword({
      token,
      newPassword: String(new FormData(event.currentTarget).get('password')),
    });
    setStatus(error ? 'error' : 'done');
  }

  if (!token || linkError) {
    return (
      <AuthLayout title="Enlace inválido">
        <Alert>El enlace venció o ya fue usado.</Alert>
        <p className="mt-6 text-sm">
          <Link to="/forgot-password" className="underline">
            Pedir un enlace nuevo
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Crea una contraseña nueva">
      {status === 'done' ? (
        <Alert tone="success">
          Contraseña actualizada.{' '}
          <Link to="/login" className="underline">
            Inicia sesión
          </Link>
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field label="Contraseña nueva" name="password" type="password" minLength={10} required autoComplete="new-password" />
          {status === 'error' && <Alert>No pudimos cambiar la contraseña. El enlace pudo haber vencido.</Alert>}
          <Button type="submit" loading={status === 'saving'}>
            Guardar contraseña
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
