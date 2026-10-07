import { useNavigate, useParams } from '@tanstack/react-router';
import { type FormEvent, useEffect, useState } from 'react';
import { authClient } from '../../shared/auth-client';
import { Alert, AuthLayout, Button, Field } from '../../shared/ui/form';
import { LEGAL_REQUIRED, LegalConsent } from '../legal/legal';
import { ROLE_LABELS, type TeamRole } from './roles';

interface InvitationInfo {
  organizationName: string;
  email: string;
  role: TeamRole;
  status: 'pending' | 'expired' | 'accepted' | 'canceled' | 'rejected';
  accountExists: boolean;
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
  return (
    <AuthLayout title="Te invitaron a BeeCRM">
      <AcceptInvitation
        invitationId={invitationId}
        onJoined={() => navigate({ to: '/login' })}
        onLoginRequired={() => navigate({ to: '/login', search: { redirect: `/invitations/${invitationId}` } })}
      />
    </AuthLayout>
  );
}

/** E01-S03 — Aceptar invitación: persona nueva crea su clave; cuenta existente inicia sesión. */
export function AcceptInvitation({ invitationId, onJoined, onLoginRequired }: {
  invitationId: string;
  onJoined: () => void;
  onLoginRequired: () => void;
}) {
  const [info, setInfo] = useState<InvitationInfo | 'missing'>();
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/invitations/${invitationId}`)
      .then(async (res) => setInfo(res.ok ? ((await res.json()) as InvitationInfo) : 'missing'))
      .catch(() => setInfo('missing'));
  }, [invitationId]);

  async function accept(body: object) {
    setSending(true);
    setError(undefined);
    const res = await fetch(`/api/v1/invitations/${invitationId}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSending(false);
    if (res.ok) return onJoined();
    setError(res.status === 410 ? 'La invitación ya no es válida.' : 'No pudimos completar la invitación. Inténtalo de nuevo.');
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('acceptLegal') !== 'on') return setError(LEGAL_REQUIRED);
    void accept({ name: String(form.get('name')), password: String(form.get('password')), acceptLegal: true });
  }

  if (!info) return <p className="text-muted">Cargando invitación…</p>;
  if (info === 'missing') return <Alert>Esta invitación no existe. Revisa el enlace del correo.</Alert>;
  if (info.status !== 'pending') return <Alert>{UNUSABLE[info.status]}</Alert>;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[#4b4c4e] text-center m-auto">
        Te invitaron como <strong>{ROLE_LABELS[info.role].toLowerCase()}</strong> a <strong>{info.organizationName}</strong> con{' '}
        <span className="text-muted">{info.email}</span>.
      </p>
      {info.accountExists ? (
        <ExistingAccount email={info.email} onAccept={() => accept({})} onLoginRequired={onLoginRequired} sending={sending} />
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field auth label="Tu nombre" name="name" required autoComplete="name" />
          <Field auth label="Crea una contraseña" name="password" type="password" minLength={10} required autoComplete="new-password" />
          <LegalConsent />
          <Button type="submit" loading={sending}>Unirme al equipo</Button>
        </form>
      )}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}

function ExistingAccount({ email, onAccept, onLoginRequired, sending }: {
  email: string;
  onAccept: () => void;
  onLoginRequired: () => void;
  sending: boolean;
}) {
  const session = authClient.useSession();
  const loggedAsInvitee = session.data?.user.email.toLowerCase() === email.toLowerCase();
  return loggedAsInvitee ? (
    <Button onClick={onAccept} loading={sending}>Aceptar invitación</Button>
  ) : (
    <Button onClick={onLoginRequired}>Iniciar sesión para aceptar</Button>
  );
}
