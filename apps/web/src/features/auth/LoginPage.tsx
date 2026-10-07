import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { authClient } from '../../shared/auth-client';
import { Alert, AuthLayout, Button, Field } from '../../shared/ui/form';

/**
 * Solo rutas internas: "//evil.com" o "https://evil.com" serían un open redirect (phishing).
 */
export function safeRedirect(target: string | undefined, fallback = '/deals'): string {
  return target && /^\/(?![/\\])/.test(target) ? target : fallback;
}

/** E01-S02 — Inicio de sesión. */
export function LoginPage() {
  const navigate = useNavigate();
  const { verified, redirect } = useSearch({ strict: false }) as { verified?: string; redirect?: string };
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setError(undefined);
    const { error } = await authClient.signIn.email({
      email: String(form.get('email')),
      password: String(form.get('password')),
    });
    setLoading(false);
    if (!error) return navigate({ to: safeRedirect(redirect) });
    if (error.status === 403) setError('Primero confirma tu correo. Te enviamos un enlace al registrarte.');
    else if (error.status === 429) setError(error.message ?? 'Demasiados intentos. Espera unos minutos.');
    else setError('Correo o contraseña incorrectos.');
  }

  return (
    <AuthLayout title={<>Inicia sesión en <span className="text-honey">BeeCRM</span></>} subtitle="Ingresa a tu cuenta para continuar trabajando.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {verified && <Alert tone="success">Correo confirmado. Ya puedes iniciar sesión.</Alert>}
        <Field auth label="Correo" name="email" type="email" required autoComplete="email" placeholder="Ingresa tu correo" />
        <Field auth label="Contraseña" name="password" type="password" required autoComplete="current-password" placeholder="Ingresa tu contraseña" />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" loading={loading} className="mt-2 w-full">
          Entrar
        </Button>
      </form>
      <div className="mt-6 flex flex-wrap justify-between gap-3 text-sm text-auth-muted">
        <Link to="/forgot-password" className="underline hover:text-auth-text">
          Olvidé mi contraseña
        </Link>
        <Link to="/register" className="font-medium text-auth-text underline">
          Crear cuenta
        </Link>
      </div>
    </AuthLayout>
  );
}
