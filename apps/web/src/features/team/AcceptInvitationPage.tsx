import { useNavigate, useParams } from '@tanstack/react-router';
import { type FormEvent, useEffect, useState } from 'react';
import { authClient } from '../../shared/auth-client';
import { Alert, AuthLayout, Button, Field } from '../../shared/ui/form';
import { PASSWORD_MIN_LENGTH } from '../auth/RegisterPage';
import { LEGAL_REQUIRED, LegalConsent } from '../legal/legal';
import { ROLE_LABELS, type TeamRole } from './roles';

interface InvitationInfo {
  organizationName: string;
  email: string;
  role: TeamRole;
  status: 'pending' | 'expired' | 'accepted' | 'canceled' | 'rejected';
  accountExists: boolean;
}

interface Credentials {
  email: string;
  password: string;
}

const UNUSABLE: Record<Exclude<InvitationInfo['status'], 'pending'>, string> = {
  expired: 'Esta invitación venció. Pide una nueva a quien te invitó.',
  accepted: 'Esta invitación ya fue usada. Inicia sesión para entrar.',
  canceled: 'Esta invitación fue cancelada.',
  rejected: 'Esta invitación fue rechazada.',
};

export function AcceptInvitationPage() {
  const { invitationId } = useParams({ strict: false }) as { invitationId: string };
  const navigate = useNavigate();
  const session = authClient.useSession();

  /** Cuenta nueva: entra directo con la clave que acaba de crear (reemplaza otra sesión abierta en el navegador). */
  async function enter(credentials?: Credentials) {
    if (credentials) {
      const { error } = await authClient.signIn.email(credentials);
      if (!error) return navigate({ to: '/' });
    }
    return navigate({ to: '/login' });
  }

  return (
    <AuthLayout title="Te invitaron a BeeCRM">
      <AcceptInvitation
        invitationId={invitationId}
        signedInAs={session.data?.user.email}
        onJoined={enter}
        onLoginRequired={() => navigate({ to: '/login', search: { redirect: `/invitations/${invitationId}` } })}
      />
    </AuthLayout>
  );
}

/** E01-S03 — Aceptar invitación: persona nueva crea su clave; cuenta existente inicia sesión. */
export function AcceptInvitation({ invitationId, signedInAs, onJoined, onLoginRequired }: {
  invitationId: string;
  /** Correo de la sesión abierta en este navegador, si hay una. */
  signedInAs?: string;
  onJoined: (credentials?: Credentials) => unknown;
  onLoginRequired: () => void;
}) {
  const [info, setInfo] = useState<InvitationInfo | 'missing'>();
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; password?: string; legal?: string }>({});
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/invitations/${invitationId}`)
      .then(async (res) => setInfo(res.ok ? ((await res.json()) as InvitationInfo) : 'missing'))
      .catch(() => setInfo('missing'));
  }, [invitationId]);

  async function accept(body: object, credentials?: Credentials) {
    setSending(true);
    setError(undefined);
    const res = await fetch(`/api/v1/invitations/${invitationId}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (res?.ok) return onJoined(credentials);
    setSending(false);
    if (!res) return setError('No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.');
    // La API explica el motivo en español (sesión de otra persona, cuenta existente, invitación vencida).
    const { message } = (await res.json().catch(() => ({}))) as { message?: unknown };
    setError(
      res.status === 400
        ? 'Revisa tu nombre y la contraseña e inténtalo de nuevo.'
        : res.status < 500 && typeof message === 'string'
          ? message
          : 'No pudimos completar la invitación. Inténtalo de nuevo.',
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>, email: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name')).trim();
    const password = String(form.get('password'));
    const errors = {
      name: name.length < 2 ? 'Escribe tu nombre.' : undefined,
      password: password.length < PASSWORD_MIN_LENGTH ? `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.` : undefined,
      legal: form.get('acceptLegal') === 'on' ? undefined : LEGAL_REQUIRED,
    };
    setFieldErrors(errors);
    if (errors.name || errors.password || errors.legal) return;
    void accept({ name, password, acceptLegal: true }, { email, password });
  }

  if (!info) return <p className="text-muted">Cargando invitación…</p>;
  if (info === 'missing') return <Alert>Esta invitación no existe. Revisa el enlace del correo.</Alert>;
  if (info.status !== 'pending') return <Alert>{UNUSABLE[info.status]}</Alert>;

  const otherSession = signedInAs && signedInAs.toLowerCase() !== info.email.toLowerCase() ? signedInAs : undefined;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[#4b4c4e] text-center m-auto">
        Te invitaron como <strong>{ROLE_LABELS[info.role].toLowerCase()}</strong> a <strong>{info.organizationName}</strong> con{' '}
        <span className="text-muted">{info.email}</span>.
      </p>
      {info.accountExists ? (
        <ExistingAccount loggedAsInvitee={Boolean(signedInAs) && !otherSession} otherSession={otherSession} email={info.email} onAccept={() => accept({})} onLoginRequired={onLoginRequired} sending={sending} />
      ) : (
        <form onSubmit={(event) => onSubmit(event, info.email)} className="flex flex-col gap-4" noValidate>
          {otherSession && (
            <p className="rounded-lg border border-auth-line px-3 py-2 text-sm text-auth-muted">
              Tienes la sesión abierta como <span className="text-auth-text">{otherSession}</span>. Al unirte, entrarás con tu cuenta nueva.
            </p>
          )}
          <Field auth label="Tu nombre" name="name" required autoComplete="name" error={fieldErrors.name} />
          <Field auth label="Crea una contraseña" name="password" type="password" minLength={PASSWORD_MIN_LENGTH} required autoComplete="new-password" error={fieldErrors.password} placeholder={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres`} />
          <LegalConsent error={fieldErrors.legal} />
          <Button type="submit" loading={sending}>Unirme al equipo</Button>
        </form>
      )}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}

function ExistingAccount({ loggedAsInvitee, otherSession, email, onAccept, onLoginRequired, sending }: {
  loggedAsInvitee: boolean;
  otherSession?: string;
  email: string;
  onAccept: () => void;
  onLoginRequired: () => void;
  sending: boolean;
}) {
  if (loggedAsInvitee) return <Button onClick={onAccept} loading={sending}>Aceptar invitación</Button>;
  return (
    <>
      {otherSession && (
        <p className="text-center text-sm text-auth-muted">
          Tienes la sesión abierta como {otherSession}. Inicia sesión con {email} para aceptar.
        </p>
      )}
      <Button onClick={onLoginRequired}>Iniciar sesión para aceptar</Button>
    </>
  );
}
