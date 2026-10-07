import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { authClient } from '../../shared/auth-client';
import { AppShell } from '../../shared/ui/app-shell';
import { Alert, Button, Field } from '../../shared/ui/form';
import { ROLE_LABELS, type TeamRole } from './roles';

interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: TeamRole;
}
interface Invitation {
  id: string;
  email: string;
  role: TeamRole;
  expiresAt: string;
}

const errorMessage = (error: unknown) =>
  error instanceof ApiError
    ? error.status === 403
      ? 'No tienes permiso para esta acción.'
      : error.message
    : 'Algo salió mal. Inténtalo de nuevo.';

/** E01-S03 / E01-S04 — Equipo, roles e invitaciones. */
export function TeamPage() {
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<Member[]>('/api/v1/members') });
  const invitations = useQuery({ queryKey: ['invitations'], queryFn: () => api<Invitation[]>('/api/v1/invitations') });
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['members'] }),
    queryClient.invalidateQueries({ queryKey: ['invitations'] }),
  ]);

  const myRole = members.data?.find((m) => m.userId === session.data?.user.id)?.role;
  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: TeamRole }) => api(`/api/v1/members/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/v1/members/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: (id: string) => api(`/api/v1/invitations/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const actionError = changeRole.error ?? remove.error ?? cancel.error;

  if (members.error instanceof ApiError && members.error.status === 403) {
    return (
      <AppShell title="Equipo">
        <Alert>Solo propietarios y administradores pueden ver el equipo.</Alert>
      </AppShell>
    );
  }

  return (
    <AppShell title="Equipo" subtitle="Invita a tu equipo y define qué puede hacer cada persona.">
      <InviteForm canInviteAdmins={myRole === 'owner'} onInvited={refresh} />

      {actionError && <div className="mt-4"><Alert>{errorMessage(actionError)}</Alert></div>}

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Miembros</h2>
        {members.isPending && <p className="mt-3 text-muted">Cargando equipo…</p>}
        {members.isError && <div className="mt-3"><Alert>No pudimos cargar el equipo. Recarga la página.</Alert></div>}
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface">
          {members.data?.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{m.name}</p>
                <p className="truncate text-sm text-muted">{m.email}</p>
              </div>
              {myRole === 'owner' && m.role !== 'owner' ? (
                <select
                  aria-label={`Rol de ${m.name}`}
                  value={m.role}
                  onChange={(e) => changeRole.mutate({ id: m.id, role: e.target.value as TeamRole })}
                  className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
                >
                  <option value="admin">{ROLE_LABELS.admin}</option>
                  <option value="member">{ROLE_LABELS.member}</option>
                </select>
              ) : (
                <span className="text-sm text-muted">{ROLE_LABELS[m.role]}</span>
              )}
              {canRemove(myRole, m) && m.userId !== session.data?.user.id && (
                <button
                  onClick={() => confirm(`¿Quitar a ${m.name} del equipo?`) && remove.mutate(m.id)}
                  className="inline-flex min-h-11 items-center px-2 text-sm text-danger underline"
                >
                  Quitar
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {Boolean(invitations.data?.length) && (
        <section className="mt-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Invitaciones pendientes</h2>
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface">
            {invitations.data?.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <p className="min-w-0 flex-1 truncate text-ink">{i.email}</p>
                <span className="text-sm text-muted">
                  {ROLE_LABELS[i.role]} · vence {new Date(i.expiresAt).toLocaleDateString('es-CO')}
                </span>
                <button onClick={() => cancel.mutate(i.id)} className="inline-flex min-h-11 items-center px-2 text-sm text-muted underline">
                  Cancelar
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}

function canRemove(myRole: TeamRole | undefined, target: Member) {
  if (target.role === 'owner') return false;
  return myRole === 'owner' || (myRole === 'admin' && target.role === 'member');
}

function InviteForm({ canInviteAdmins, onInvited }: { canInviteAdmins: boolean; onInvited: () => void }) {
  const [result, setResult] = useState<{ ok: boolean; message: string }>();
  const [sending, setSending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    setSending(true);
    try {
      await api('/api/v1/invitations', {
        method: 'POST',
        body: JSON.stringify({ email: String(form.get('email')), role: String(form.get('role')) }),
      });
      setResult({ ok: true, message: 'Invitación enviada. Vence en 7 días.' });
      formEl.reset();
      onInvited();
    } catch (error) {
      setResult({ ok: false, message: errorMessage(error) });
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4" noValidate>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field label="Correo de la persona" name="email" type="email" required autoComplete="off" />
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
          Rol
          <select name="role" defaultValue="member" className="h-11 rounded-lg border border-line bg-surface px-3">
            <option value="member">{ROLE_LABELS.member}</option>
            {canInviteAdmins && <option value="admin">{ROLE_LABELS.admin}</option>}
          </select>
        </label>
      </div>
      {result && <Alert tone={result.ok ? 'success' : 'danger'}>{result.message}</Alert>}
      <div>
        <Button type="submit" loading={sending}>Enviar invitación</Button>
      </div>
    </form>
  );
}
