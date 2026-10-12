import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useDebouncedValue } from '../use-debounced-value';

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
    return <Banner tone="danger" icon="!" title="Tu cuenta está en solo lectura" text="Puedes ver y exportar todo, pero no modificar. Tus datos están intactos." cta="Activar un plan" />;
  }
  if (status === 'past_due') {
    return <Banner icon="$" title="No pudimos cobrar tu suscripción" text="Reintentamos en unos días. Revisa la tarjeta para no perder el acceso." cta="Revisar tarjeta" />;
  }
  if (status === 'trialing' && trialEndsAt) {
    const days = Math.ceil((Date.parse(trialEndsAt) - Date.now()) / 86_400_000);
    if (days > 7) return null;
    return <Banner icon="⌛" title={`Te ${days === 1 ? 'queda 1 día' : `quedan ${days} días`} de prueba`} text="Elige un plan para seguir trabajando sin interrupciones." cta="Elegir plan" />;
  }
  return null;
}

/** Mismo patrón que el banner de "Conecta un canal" del Inicio: ícono, título, bajada y acción. */
function Banner({ tone = 'honey', icon, title, text, cta }: { tone?: 'honey' | 'danger'; icon: string; title: string; text: string; cta: string }) {
  const box = tone === 'danger' ? 'border-danger/40 bg-danger-soft' : 'border-honey/50 bg-honey-soft';
  const tile = tone === 'danger' ? 'bg-danger text-surface' : 'bg-honey text-ink';
  return (
    <section role="status" className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${box}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden className={`grid size-8 place-items-center rounded-md font-semibold ${tile}`}>{icon}</span>
        <div>
          <h2 className={`text-sm font-semibold ${tone === 'danger' ? 'text-danger' : 'text-ink'}`}>{title}</h2>
          <p className="mt-0.5 text-xs text-muted">{text}</p>
        </div>
      </div>
      <Link to="/settings" search={{ tab: 'plan' }} className="rounded-lg bg-surface px-3 py-2 text-xs font-semibold text-ink shadow-sm">{cta}</Link>
    </section>
  );
}
