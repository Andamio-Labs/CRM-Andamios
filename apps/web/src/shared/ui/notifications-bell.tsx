import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useRegion } from '../i18n/use-region';
import { linkTarget } from '../link-target';
import { feedCounts, type FeedFilter, type FeedItem, filterFeed, groupByDay, relativeTime } from '../notification-feed';
import { useRealtime } from '../realtime';

/** Categoría corta e ícono de cada tipo (el catálogo completo vive en la API). */
const TYPE_META: Record<string, { label: string; icon: string }> = {
  task_reminder: { label: 'Recordatorio', icon: '☑' },
  no_reply: { label: 'Mensajes', icon: '▤' },
  sla_breach: { label: 'Tiempo de respuesta', icon: '!' },
  deal_won: { label: 'Negocio ganado', icon: '★' },
  ai_handoff: { label: 'Asistente IA', icon: '✦' },
  ai_quota: { label: 'Asistente IA', icon: '✦' },
  join_request: { label: 'Equipo', icon: '♙' },
  billing: { label: 'Plan y pagos', icon: '$' },
};
const FALLBACK_META = { label: 'Aviso', icon: '•' };

const FILTERS: { id: FeedFilter; label: string; empty: string }[] = [
  { id: 'all', label: 'Todas', empty: 'No tienes notificaciones.' },
  { id: 'unread', label: 'Sin leer', empty: 'Todo leído. Buen trabajo.' },
  { id: 'important', label: 'Importantes', empty: 'No hay avisos importantes.' },
];

const iconButton = 'grid size-8 place-items-center rounded-lg text-muted transition hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey disabled:opacity-40';

function Icon({ children, className = 'size-4' }: { children: ReactNode; className?: string }) {
  return <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}
const BellPath = () => <><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>;

/**
 * E06-S02 / E14-S04 — Campana: filtros, agrupado por día, marcar leídas y acceso a preferencias. En vivo.
 * `rail`: en la barra derecha de desktop, el panel se abre a su izquierda. `header`: en la barra superior (móvil).
 */
export function NotificationsBell({ placement = 'header' }: { placement?: 'header' | 'rail' }) {
  const queryClient = useQueryClient();
  const { date, region } = useRegion();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [now, setNow] = useState(() => new Date());
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const notifications = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ items: FeedItem[]; unread: number }>('/api/v1/notifications') });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const read = useMutation({ mutationFn: (id: string) => api(`/api/v1/notifications/${id}/read`, { method: 'POST' }), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: () => api('/api/v1/notifications/read-all', { method: 'POST' }), onSuccess: refresh });

  useRealtime(['notification.created'], () => void refresh());

  // Abierto: cierra con clic afuera o Escape, y mantiene al día el "hace N min".
  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    const tick = window.setInterval(() => setNow(new Date()), 60_000);
    const onPointer = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { window.clearInterval(tick); document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const items = notifications.data?.items ?? [];
  const unread = notifications.data?.unread ?? 0;
  const counts = { ...feedCounts(items), unread };
  const visible = filterFeed(items, filter);
  const groups = groupByDay(visible, now, region.timeZone, date);
  const current = FILTERS.find((f) => f.id === filter)!;

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unread ? `Notificaciones, ${unread} sin leer` : 'Notificaciones'}
        className="relative grid min-h-10 min-w-10 place-items-center rounded-lg text-ink transition hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey"
      >
        <Icon className="size-5"><BellPath /></Icon>
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-w-[1.125rem] place-items-center rounded-full bg-info px-1 text-[10px] font-bold leading-[1.125rem] text-white ring-2 ring-surface">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div role="dialog" aria-label="Notificaciones" className={`z-30 flex w-[min(28rem,calc(100vw-1.5rem))] ${placement === 'rail' ? 'fixed right-[4.25rem] top-14' : 'absolute right-0 mt-2'} flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl`}>
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-honey-soft text-ink ring-1 ring-honey/40"><Icon><BellPath /></Icon></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">Notificaciones</p>
              <p className="text-xs text-muted">{unread ? `${unread} sin leer` : 'Todo al día'}</p>
            </div>
            <div className="flex items-center gap-0.5">
              <button onClick={() => void notifications.refetch()} aria-label="Actualizar" title="Actualizar" className={iconButton}>
                <Icon className={`size-4 ${notifications.isFetching ? 'animate-spin' : ''}`}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></Icon>
              </button>
              <button onClick={() => readAll.mutate()} disabled={!unread || readAll.isPending} aria-label="Marcar todas como leídas" title="Marcar todas como leídas" className={iconButton}>
                <Icon><path d="M2 12.5 6 16.5 14 8" /><path d="m10 16.5 1 1 9-9.5" /></Icon>
              </button>
              <Link to="/profile" search={{ tab: 'notificaciones' }} onClick={() => setOpen(false)} aria-label="Configurar notificaciones" title="Configurar notificaciones" className={iconButton}>
                <Icon><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></Icon>
              </Link>
              <button onClick={() => { setOpen(false); trigger.current?.focus(); }} aria-label="Cerrar" title="Cerrar" className={iconButton}>
                <Icon><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Icon>
              </button>
            </div>
          </div>

          <div role="tablist" aria-label="Filtrar notificaciones" className="flex gap-1 border-b border-line px-3 py-2">
            {FILTERS.map((f) => {
              const active = f.id === filter;
              const count = counts[f.id];
              return (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(f.id)}
                  className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition ${active ? 'bg-honey-soft text-ink' : 'text-muted hover:bg-raised hover:text-ink'}`}
                >
                  {f.label}
                  {count > 0 && <span className={`grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold leading-4 ${active ? 'bg-honey text-on-honey' : 'bg-raised text-muted'}`}>{count}</span>}
                </button>
              );
            })}
          </div>

          <div className="max-h-[min(26rem,60vh)] overflow-y-auto overscroll-contain">
            {notifications.isPending && <p className="px-4 py-8 text-center text-xs text-muted">Cargando…</p>}
            {notifications.isError && <p className="px-4 py-8 text-center text-xs text-danger">No pudimos cargar tus notificaciones.</p>}
            {notifications.isSuccess && !visible.length && <p className="px-4 py-10 text-center text-xs text-muted">{current.empty}</p>}
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label}>
                <h3 className="sticky top-0 z-[1] border-b border-line bg-surface px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
                  {g.label} <span className="font-medium">· {g.items.length}</span>
                </h3>
                <ul>
                  {g.items.map((n) => {
                    const meta = TYPE_META[n.type] ?? FALLBACK_META;
                    return (
                      <li key={n.id} className="border-b border-line last:border-b-0">
                        <Link
                          {...(linkTarget(n.link) as { to: '/' })}
                          onClick={() => { if (!n.readAt) read.mutate(n.id); setOpen(false); }}
                          className={`group flex gap-3 border-l-2 px-4 py-3 transition ${n.readAt ? 'border-transparent hover:bg-canvas' : 'border-honey bg-raised hover:brightness-[0.98]'}`}
                        >
                          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-honey-soft text-sm font-semibold text-ink">{meta.icon}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-[11px] text-muted">
                              <span className="font-semibold text-ink">{meta.label}</span>
                              {n.important && <span className="rounded-full bg-danger-soft px-1.5 text-[10px] font-semibold text-danger">Importante</span>}
                              {!n.readAt && <span className="size-1.5 rounded-full bg-honey"><span className="sr-only">Sin leer</span></span>}
                            </span>
                            <span className="mt-0.5 block text-sm leading-snug text-ink">{n.title}</span>
                            {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{n.body}</span>}
                            <span className="mt-1 flex items-center gap-1 text-[11px] text-muted">
                              <Icon className="size-3"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>
                              <time dateTime={n.createdAt} title={date(n.createdAt)}>{relativeTime(n.createdAt, now)}</time>
                              {n.link && <><span aria-hidden>·</span><span className="font-medium text-ink underline-offset-2 group-hover:underline">Abrir</span></>}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs">
            <span className="text-muted">Total: {items.length}</span>
            <Link to="/profile" search={{ tab: 'notificaciones' }} onClick={() => setOpen(false)} className="font-medium text-ink underline-offset-2 hover:underline">
              Configurar avisos →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
