import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useRegion } from '../i18n/use-region';
import { useRealtime } from '../realtime';
import { useDebouncedValue } from '../use-debounced-value';

interface Notification { id: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }

/** E06-S02 / E14-S04 — Campana con contador, lista y marcar como leídas. Se actualiza en vivo. */
export function NotificationsBell() {
  const queryClient = useQueryClient();
  const { date, time } = useRegion();
  const [open, setOpen] = useState(false);
  const notifications = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ items: Notification[]; unread: number }>('/api/v1/notifications') });
  const read = useMutation({
    mutationFn: (id: string) => api(`/api/v1/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const readAll = useMutation({
    mutationFn: () => api('/api/v1/notifications/read-all', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useRealtime(['notification.created'], () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }));

  const unread = notifications.data?.unread ?? 0;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={unread ? `Notificaciones, ${unread} sin leer` : 'Notificaciones'}
        className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {unread > 0 && <span className="absolute right-1 top-1 rounded-full bg-danger px-1.5 text-[11px] font-semibold text-surface">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <p className="font-medium text-ink">Notificaciones</p>
            {unread > 0 && <button onClick={() => readAll.mutate()} className="min-h-11 text-sm text-muted underline">Marcar todas</button>}
          </div>
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {notifications.data?.items.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No tienes notificaciones.</li>}
            {notifications.data?.items.map((n) => (
              <li key={n.id} className={n.readAt ? '' : 'bg-honey/10'}>
                <Link
                  to={(n.link ?? '/') as '/'}
                  onClick={() => { if (!n.readAt) read.mutate(n.id); setOpen(false); }}
                  className="block px-4 py-3"
                >
                  <p className="text-sm font-medium text-ink">{n.title}</p>
                  {n.body && <p className="text-sm text-muted">{n.body}</p>}
                  <p className="mt-1 text-xs text-muted">{date(n.createdAt)} {time(n.createdAt)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface SearchResult {
  contacts: { id: string; name: string; phone: string | null }[];
  companies: { id: string; name: string }[];
  deals: { id: string; title: string }[];
}

/** Búsqueda global con la misma interacción existente, presentada como control compacto. */
export function CommandPalette({ label = 'Buscar' }: { label?: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const query = useDebouncedValue(q.trim());
  const results = useQuery({ queryKey: ['palette', query], queryFn: () => api<SearchResult>(`/api/v1/search?q=${encodeURIComponent(query)}`), enabled: query.length >= 2 });

  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  function go(to: string) {
    setOpen(false);
    setQ('');
    void navigate({ to: to as '/' });
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="hidden min-h-9 min-w-24 items-center gap-2 rounded-lg border border-line px-3 text-xs text-muted sm:inline-flex">
        <svg aria-hidden viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        {label}
      </button>
      <button onClick={() => setOpen(true)} aria-label="Buscar" className="inline-flex min-h-11 min-w-11 items-center justify-center text-ink sm:hidden">
        <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Búsqueda global" className="fixed inset-0 z-30 flex items-start justify-center bg-ink/40 px-4 pt-[10vh]" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-xl bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca clientes, empresas o negocios…" aria-label="Buscar" className="h-12 w-full rounded-t-xl border-b border-line px-4 outline-none" />
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {query.length < 2 && <p className="px-2 py-4 text-sm text-muted">Escribe al menos 2 letras. Sin tildes también funciona.</p>}
              {results.isFetching && <p className="px-2 py-4 text-sm text-muted">Buscando…</p>}
              {results.data && (
                <>
                  <Group title="Clientes" items={results.data.contacts.map((c) => ({ key: c.id, label: c.name, hint: c.phone, to: `/contacts?open=${c.id}` }))} go={go} />
                  <Group title="Negocios" items={results.data.deals.map((d) => ({ key: d.id, label: d.title, hint: null, to: `/deals?deal=${d.id}` }))} go={go} />
                  <Group title="Empresas" items={results.data.companies.map((c) => ({ key: c.id, label: c.name, hint: null, to: '/contacts' }))} go={go} />
                  {!results.data.contacts.length && !results.data.deals.length && !results.data.companies.length && <p className="px-2 py-4 text-sm text-muted">Sin resultados.</p>}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Group({ title, items, go }: { title: string; items: { key: string; label: string; hint: string | null; to: string }[]; go: (to: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="py-1">
      <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted">{title}</p>
      {items.map((i) => (
        <button key={i.key} onClick={() => go(i.to)} className="flex min-h-11 w-full items-center justify-between rounded-lg px-2 text-left hover:bg-canvas">
          <span className="truncate text-ink">{i.label}</span>
          {i.hint && <span className="text-sm text-muted">{i.hint}</span>}
        </button>
      ))}
    </div>
  );
}

interface PlanStatus { plan: string; status: string; trialEndsAt: string | null }

/** E10-S02 — Aviso de prueba por vencer y de cuenta en solo lectura, en todas las pantallas. */
export function AccountBanner() {
  const plan = useQuery({ queryKey: ['plan'], queryFn: () => api<PlanStatus>('/api/v1/plan'), staleTime: 60_000 });
  if (!plan.data) return null;
  const { status, trialEndsAt } = plan.data;
  if (status === 'read_only' || status === 'canceled') {
    return (
      <p role="status" className="mb-4 rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">
        Tu cuenta está en solo lectura: podés ver y exportar todo, pero no modificar. <Link to="/settings" className="font-semibold underline">Activá un plan</Link> para seguir trabajando.
      </p>
    );
  }
  if (status === 'past_due') {
    return <p role="status" className="mb-4 rounded-lg bg-honey/25 px-4 py-3 text-sm text-ink">No pudimos cobrar tu suscripción. <Link to="/settings" className="font-semibold underline">Revisá tu tarjeta</Link>.</p>;
  }
  if (status === 'trialing' && trialEndsAt) {
    const days = Math.ceil((Date.parse(trialEndsAt) - Date.now()) / 86_400_000);
    if (days > 7) return null;
    return <p role="status" className="mb-4 rounded-lg bg-honey/25 px-4 py-3 text-sm text-ink">Te {days === 1 ? 'queda 1 día' : `quedan ${days} días`} de prueba. <Link to="/settings" className="font-semibold underline">Elegí un plan</Link>.</p>;
  }
  return null;
}
