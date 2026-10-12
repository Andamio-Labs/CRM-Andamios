import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { useRegion } from '../../shared/i18n/use-region';
import { Alert } from '../../shared/ui/form';
import { Badge } from '../../shared/ui/section';
import { COMPANIES_KEY, ICONS, type MyCompany, Svg } from './ProfileOverview';
import { REQUEST_STATUS } from './profile-format';

interface JoinRequest { id: string; companyName: string; status: keyof typeof REQUEST_STATUS; createdAt: string; decidedAt: string | null }

const REQUESTS_KEY = ['my-companies', 'requests'];

const ICON = {
  store: <><path d="M3 9h18l-1.5-5h-15z" /><path d="M4 9v11h16V9" /><path d="M9 20v-6h6v6" /><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" /></>,
  pencil: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  join: <><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0" /><path d="M19 8v6M16 11h6" /></>,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  refresh: <><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></>,
  check: <path d="m5 12 5 5L20 7" />,
};

/** Pestaña Empresa: mis empresas, crear otra, unirse con código y mis solicitudes. */
export function CompaniesTab() {
  const companies = useQuery({ queryKey: COMPANIES_KEY, queryFn: () => api<MyCompany[]>('/api/v1/my-companies') });
  const [dialog, setDialog] = useState<null | 'join' | 'create' | { rename: MyCompany }>(null);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-ink">Configuración de empresas</h2>
          <p className="mt-2 text-sm text-muted">Gestiona tus empresas y el acceso de tu equipo.</p>
        </div>
        <div className="flex gap-2.5">
          <button onClick={() => setDialog('join')} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm text-ink transition hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey">
            <Svg>{ICON.join}</Svg>Unirse
          </button>
          <button onClick={() => setDialog('create')} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-honey to-honey-deep px-5 text-sm font-semibold text-on-honey shadow-[0_6px_20px_rgb(245_183_0/0.35)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey focus-visible:ring-offset-2 focus-visible:ring-offset-canvas">
            <Svg>{ICON.plus}</Svg>Crear empresa
          </button>
        </div>
      </header>

      {companies.isPending && <p className="text-sm text-muted">Cargando…</p>}
      {companies.isError && <Alert>No pudimos cargar tus empresas.</Alert>}
      <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
        {companies.data?.map((c) => <CompanyCard key={c.id} company={c} onRename={() => setDialog({ rename: c })} />)}
      </div>

      <MyRequests />

      {dialog === 'join' && <JoinDialog onClose={() => setDialog(null)} />}
      {dialog === 'create' && <CreateDialog onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && <RenameDialog company={dialog.rename} onClose={() => setDialog(null)} />}
    </div>
  );
}

function CompanyCard({ company: c, onRename }: { company: MyCompany; onRename: () => void }) {
  const { region } = useRegion();
  const [copied, setCopied] = useState(false);
  const activate = useMutation({
    mutationFn: () => api(`/api/v1/my-companies/${c.id}/activate`, { method: 'POST' }),
    // Recarga completa: cachés, WebSocket y permisos quedan atados a la empresa anterior.
    onSuccess: () => window.location.assign('/'),
  });
  const created = new Intl.DateTimeFormat(region.locale, { timeZone: region.timeZone, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(c.createdAt));

  async function copy() {
    if (!c.joinCode) return;
    try {
      await navigator.clipboard.writeText(c.joinCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* sin permiso de portapapeles: el código igual se ve */ }
  }

  return (
    <article className={`relative overflow-hidden rounded-2xl border bg-surface p-5 ${c.active ? 'border-honey/60' : 'border-line'}`}>
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-[radial-gradient(closest-side,rgb(255_255_255/0.07),transparent)]" />
      <div className="relative flex items-start justify-between">
        <span aria-hidden className="grid size-12 place-items-center rounded-xl bg-white text-honey-deep shadow-sm"><Svg className="size-6">{ICON.store}</Svg></span>
        {c.active && c.role === 'owner' && (
          <button onClick={onRename} aria-label={`Cambiar el nombre de ${c.name}`} title="Cambiar nombre" className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-raised hover:text-ink">
            <Svg className="size-3.5">{ICON.pencil}</Svg>
          </button>
        )}
      </div>
      <h3 className="relative mt-4 truncate text-base text-ink">{c.name}</h3>
      <div className="relative mt-2 flex flex-wrap items-center gap-2">
        {c.joinCode && (
          <button onClick={() => void copy()} title="Copiar código" className="inline-flex items-center gap-1 rounded-full border border-honey/40 bg-honey-soft px-2.5 py-1 font-mono text-xs text-ink transition hover:border-honey">
            {c.joinCode}<Svg className="size-3">{copied ? ICON.check : ICON.copy}</Svg>
            <span className="sr-only">{copied ? 'Código copiado' : 'Copiar código'}</span>
          </button>
        )}
        <span className="rounded-full bg-raised px-2.5 py-1 text-xs font-semibold text-ink">{c.currency}</span>
        {c.active && <span className="rounded-full bg-honey px-2 py-0.5 text-[10px] font-bold text-on-honey">Activa</span>}
      </div>
      {c.joinCode && <p className="relative mt-1.5 text-xs text-muted">Código para invitar empleados</p>}

      <dl className="relative mt-4 rounded-xl border border-line bg-canvas/60 px-3.5 py-1 text-sm">
        <div className="flex items-center justify-between py-2.5">
          <dt className="text-muted">Configuración del CRM</dt>
          <dd><StatusPill ok={c.crmConfigured} okLabel="Configurado" pendingLabel="Pendiente" /></dd>
        </div>
        <div className="flex items-center justify-between border-b border-line pb-3 pt-1">
          <dt className="text-muted">Embudo de ventas</dt>
          <dd><StatusPill ok={c.funnelCreated} okLabel="Creado" pendingLabel="Sin crear" plain /></dd>
        </div>
        <div className="flex items-center justify-between py-3">
          <dt className="text-muted">Fecha de creación</dt>
          <dd className="font-semibold text-ink">{created}</dd>
        </div>
      </dl>

      <button
        onClick={() => (c.active ? window.location.assign('/') : activate.mutate())}
        disabled={activate.isPending}
        className="relative mt-4 flex min-h-11 w-full items-center justify-between rounded-lg border border-line bg-canvas/60 px-4 text-sm text-ink transition hover:border-honey/60 hover:bg-raised disabled:opacity-60"
      >
        {activate.isPending ? 'Abriendo…' : 'Abrir empresa'}<Svg>{ICON.arrow}</Svg>
      </button>
      {activate.isError && <div className="mt-3"><Alert>No pudimos abrir esa empresa. Inténtalo de nuevo.</Alert></div>}
    </article>
  );
}

function StatusPill({ ok, okLabel, pendingLabel, plain }: { ok: boolean; okLabel: string; pendingLabel: string; plain?: boolean }) {
  if (!ok) return <Badge tone="neutral">{pendingLabel}</Badge>;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-bold text-success ring-1 ring-success/30">
      {!plain && <Svg className="size-3.5">{ICONS.check}</Svg>}{okLabel}
    </span>
  );
}

function MyRequests() {
  const queryClient = useQueryClient();
  const { date } = useRegion();
  const requests = useQuery({ queryKey: REQUESTS_KEY, queryFn: () => api<JoinRequest[]>('/api/v1/my-companies/requests') });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/api/v1/my-companies/requests/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: REQUESTS_KEY }),
  });

  return (
    <section aria-labelledby="my-requests" className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-center gap-4">
        <h2 id="my-requests" className="text-xl text-ink">Mis solicitudes</h2>
        <span aria-hidden className="h-px flex-1 bg-line" />
      </div>
      <div className="mt-5 overflow-hidden rounded-xl border border-line">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-base font-semibold text-ink">Solicitudes para unirme</h3>
          <button onClick={() => void requests.refetch()} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink transition hover:bg-raised">
            <Svg className={`size-3.5 ${requests.isFetching ? 'animate-spin' : ''}`}>{ICON.refresh}</Svg>Actualizar
          </button>
        </div>
        {requests.isError && <div className="p-4"><Alert>No pudimos cargar tus solicitudes.</Alert></div>}
        {requests.data && !requests.data.length && (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <EmptyTray />
            <p className="text-sm text-muted">No tienes solicitudes. Pide a tu empresa el código e ingrésalo en «Unirse».</p>
          </div>
        )}
        {!!requests.data?.length && (
          <ul className="divide-y divide-line">
            {requests.data.map((r) => {
              const status = REQUEST_STATUS[r.status];
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{r.companyName}</span>
                    <span className="text-xs text-muted">Enviada el {date(r.createdAt)}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    {r.status === 'pending' && (
                      <button onClick={() => cancel.mutate(r.id)} disabled={cancel.isPending} className="text-xs font-medium text-muted underline-offset-2 hover:text-danger hover:underline">Cancelar</button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function EmptyTray() {
  return (
    <svg aria-hidden viewBox="0 0 96 72" className="h-20 w-28 text-muted">
      <ellipse cx="44" cy="66" rx="30" ry="4" fill="currentColor" opacity="0.15" />
      <path d="M18 34h52l-4 26a4 4 0 0 1-4 3H26a4 4 0 0 1-4-3z" fill="currentColor" opacity="0.45" />
      <rect x="28" y="16" width="32" height="26" rx="2" fill="currentColor" opacity="0.7" />
      <path d="M33 23h22M33 29h22M33 35h14" stroke="var(--color-surface)" strokeWidth="2" strokeLinecap="round" />
      <path d="M18 34h14l3 6h18l3-6h14" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.8" />
      <circle cx="78" cy="14" r="9" fill="currentColor" opacity="0.6" />
      <path d="M74 14h0M78 14h0M82 14h0" stroke="var(--color-surface)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function Dialog({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLInputElement>('input')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div ref={panel} className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="bg-honey px-5 py-4 text-on-honey">
          <h2 className="text-base font-bold">{title}</h2>
          <p className="mt-0.5 text-xs opacity-80">{subtitle}</p>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

const dialogInput = 'mt-1.5 h-11 w-full rounded-lg border border-line bg-canvas px-3 text-sm text-ink outline-none transition focus:border-honey focus:ring-2 focus:ring-honey/30';
const dialogPrimary = 'inline-flex min-h-10 items-center rounded-lg bg-honey px-4 text-sm font-semibold text-on-honey transition hover:brightness-95 disabled:opacity-60';
const dialogSecondary = 'inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm text-ink transition hover:bg-raised';

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError && error.status < 500 && error.message ? error.message : fallback;
}

function JoinDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const join = useMutation({
    mutationFn: (code: string) => api('/api/v1/my-companies/join', { method: 'POST', body: JSON.stringify({ code }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: REQUESTS_KEY }); onClose(); },
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    join.mutate(String(new FormData(e.currentTarget).get('code')).trim());
  }
  return (
    <Dialog title="Unirse a una empresa" subtitle="El equipo de la empresa revisa y aprueba tu solicitud." onClose={onClose}>
      <form onSubmit={submit}>
        <label className="text-xs font-semibold uppercase tracking-wide text-muted">
          Código de la empresa
          <input name="code" required minLength={4} maxLength={20} autoComplete="off" spellCheck={false} placeholder="Ej.: Q7QWT5ZFE7" className={`${dialogInput} font-mono uppercase tracking-widest`} />
        </label>
        {join.isError && <div className="mt-3"><Alert>{errorText(join.error, 'No pudimos enviar la solicitud. Inténtalo de nuevo.')}</Alert></div>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={dialogSecondary}>Cancelar</button>
          <button disabled={join.isPending} className={dialogPrimary}>{join.isPending ? 'Enviando…' : 'Enviar solicitud'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const create = useMutation({
    mutationFn: (name: string) => api('/api/v1/my-companies', { method: 'POST', body: JSON.stringify({ name }) }),
    // La empresa nueva queda activa: se recarga para entrar a ella.
    onSuccess: () => window.location.assign('/'),
  });
  return (
    <Dialog title="Crear empresa" subtitle="Empieza con un periodo de prueba y un embudo listo. Serás su propietario." onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); create.mutate(String(new FormData(e.currentTarget).get('name')).trim()); }}>
        <label className="text-xs font-semibold uppercase tracking-wide text-muted">
          Nombre de la empresa
          <input name="name" required minLength={2} maxLength={120} placeholder="Ej.: Andamios del Norte SAS" className={dialogInput} />
        </label>
        {create.isError && <div className="mt-3"><Alert>{errorText(create.error, 'No pudimos crear la empresa. Inténtalo de nuevo.')}</Alert></div>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={dialogSecondary}>Cancelar</button>
          <button disabled={create.isPending} className={dialogPrimary}>{create.isPending ? 'Creando…' : 'Crear empresa'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function RenameDialog({ company, onClose }: { company: MyCompany; onClose: () => void }) {
  const queryClient = useQueryClient();
  const rename = useMutation({
    mutationFn: (name: string) => api('/api/v1/my-companies/current', { method: 'PATCH', body: JSON.stringify({ name }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['my-companies'] }); void queryClient.invalidateQueries({ queryKey: ['me'] }); onClose(); },
  });
  return (
    <Dialog title="Cambiar nombre" subtitle="Tu equipo verá el nombre nuevo de inmediato." onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); rename.mutate(String(new FormData(e.currentTarget).get('name')).trim()); }}>
        <label className="text-xs font-semibold uppercase tracking-wide text-muted">
          Nombre de la empresa
          <input name="name" required minLength={2} maxLength={120} defaultValue={company.name} className={dialogInput} />
        </label>
        {rename.isError && <div className="mt-3"><Alert>{errorText(rename.error, 'No pudimos cambiar el nombre. Inténtalo de nuevo.')}</Alert></div>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={dialogSecondary}>Cancelar</button>
          <button disabled={rename.isPending} className={dialogPrimary}>{rename.isPending ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </Dialog>
  );
}
