import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { type FormEvent, Fragment, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { authClient } from '../../shared/auth-client';
import { useRegion } from '../../shared/i18n/use-region';
import { AppShell } from '../../shared/ui/app-shell';
import { Alert, Button, Field } from '../../shared/ui/form';
import { ContactTimeline } from './ContactTimeline';
import { ImportWizard } from './ImportWizard';
import { useDebouncedValue } from '../../shared/use-debounced-value';

interface Contact {
  id: string; name: string; phone: string | null; email: string | null; tags?: string[];
  source?: string | null; priority?: 'critical' | 'high' | 'medium' | 'low' | null; kind?: 'person' | 'company'; createdAt?: string;
}
interface Stats { total: number; withPhone: number; topSource: { source: string; count: number } | null }
interface Duplicate { id: string; name: string; matchedBy: 'phone' | 'email' }

const PRIORITY: Record<string, { label: string; className: string }> = {
  critical: { label: 'Crítica', className: 'bg-danger/10 text-danger' },
  high: { label: 'Alta', className: 'bg-honey/25 text-ink' },
  medium: { label: 'Media', className: 'bg-canvas text-ink' },
  low: { label: 'Baja', className: 'bg-canvas text-muted' },
};

/** E02 + X-07 — Clientes en tabla con estadísticas, "mis clientes", alta con negocio, importación y exportación. */
export function ContactsPage() {
  const queryClient = useQueryClient();
  const { date } = useRegion();
  const search = useSearch({ strict: false }) as { open?: string };
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const [openId, setOpenId] = useState<string | undefined>(search.open);
  const [importing, setImporting] = useState(false);
  const query = useDebouncedValue(q.trim());
  const searching = query.length >= 2;

  const list = useQuery({
    queryKey: ['contacts', searching ? query : '', mine],
    queryFn: async () =>
      searching
        ? (await api<{ contacts: Contact[] }>(`/api/v1/search?q=${encodeURIComponent(query)}`)).contacts
        : (await api<{ items: Contact[] }>(`/api/v1/contacts?limit=50${mine ? '&mine=true' : ''}`)).items,
  });
  const stats = useQuery({ queryKey: ['contact-stats'], queryFn: () => api<Stats>('/api/v1/contacts/stats') });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['contacts'] });
    void queryClient.invalidateQueries({ queryKey: ['contact-stats'] });
  };

  return (
    <AppShell title="Clientes" subtitle="Busca por nombre, teléfono o correo, con o sin tildes." wide>
      {stats.data && (
        <dl className="mb-3 flex flex-wrap items-center gap-x-7 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3 shadow-sm">
          <Stat label="Total" value={String(stats.data.total)} />
          <Stat label="Con teléfono" value={String(stats.data.withPhone)} />
          <Stat label="Origen principal" value={stats.data.topSource ? stats.data.topSource.source.replace('sin_origen', 'Sin origen') : 'Sin datos'} />
        </dl>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 shadow-sm">
        <div className="relative w-full min-w-0 flex-1 sm:min-w-52">
          <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">⌕</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, teléfono..." aria-label="Buscar clientes" className="h-10 w-full rounded-lg border border-line bg-canvas pl-9 pr-3 text-sm" />
        </div>
        <label className="flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-xs text-ink">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="size-4 accent-honey" /> Mis clientes
        </label>
        <button onClick={() => setImporting((v) => !v)} aria-expanded={importing} className="min-h-10 rounded-lg border border-line px-3 text-xs text-ink">Importar</button>
        <ExportMenu />
      </div>

      {importing && <ImportWizard onDone={refresh} />}
      <NewContactForm onCreated={refresh} />

      {list.isPending && <p className="mt-4 text-muted">Cargando clientes…</p>}
      {list.isError && <div className="mt-4"><Alert>No pudimos cargar los clientes.</Alert></div>}
      {list.data?.length === 0 && (
        <p className="mt-4 rounded-xl border border-line bg-surface px-4 py-8 text-center text-muted">{searching ? 'Sin resultados.' : 'Todavía no hay clientes. Crea el primero o importa un CSV.'}</p>
      )}
      {Boolean(list.data?.length) && (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="border-b border-line bg-honey-soft/30 text-[10px] uppercase tracking-wide text-muted">
              <tr>{['Cliente', 'Contacto', 'Origen', 'Prioridad', 'Fecha'].map((h) => <th key={h} scope="col" className="px-4 py-3 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.data!.map((c) => (
                <Fragment key={c.id}>
                  <tr>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-honey-soft text-ink">♙</span><div className="min-w-0"><button onClick={() => setOpenId(openId === c.id ? undefined : c.id)} aria-expanded={openId === c.id} className="block max-w-full truncate text-left text-xs font-semibold text-ink underline-offset-2 hover:underline">{c.name}</button>{c.kind === 'company' && <span className="text-[11px] text-muted">Empresa</span>}</div></div>
                    </td>
                    <td className="px-4 py-2.5"><div className="flex flex-col gap-0.5 text-[11px] text-ink">{c.phone ? <span>⌕ {c.phone}</span> : <span className="text-muted">Sin teléfono</span>}{c.email ? <span className="truncate text-muted">✉ {c.email}</span> : <span className="text-muted">Sin correo</span>}</div></td>
                    <td className="px-4 py-2.5 text-xs text-muted">{c.source ?? 'Sin origen'}</td>
                    <td className="px-4 py-2.5">{c.priority ? <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${PRIORITY[c.priority]!.className}`}>{PRIORITY[c.priority]!.label}</span> : <span className="text-xs text-muted">Sin prioridad</span>}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">{c.createdAt ? date(c.createdAt) : ''}</td>
                  </tr>
                  {openId === c.id && <tr><td colSpan={5} className="px-3 pb-4"><ContactTimeline contactId={c.id} /></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-baseline gap-1.5">
    <dd className="truncate text-lg font-semibold text-ink">{value}</dd>
    <dt className="text-xs text-muted">{label}</dt>
  </div>
);

/** E02-S09 — Solo el propietario ve la exportación (el backend también lo exige). */
function ExportMenu() {
  const session = authClient.useSession();
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<{ userId: string; role: string }[]>('/api/v1/members'), retry: false, staleTime: 60_000 });
  const isOwner = members.data?.some((m) => m.userId === session.data?.user.id && m.role === 'owner');
  if (!isOwner) return null;
  return (
    <details className="relative">
      <summary className="flex min-h-10 cursor-pointer list-none items-center rounded-lg border border-line px-3 text-xs text-ink">Exportar</summary>
      <ul className="absolute right-0 z-10 mt-1 w-48 rounded-lg border border-line bg-surface shadow-lg">
        {[['contacts', 'Clientes'], ['deals', 'Negocios'], ['tasks', 'Tareas']].map(([entity, label]) => (
          <li key={entity}><a href={`/api/v1/exports/${entity}.csv`} className="flex min-h-11 items-center px-3 text-xs text-ink hover:bg-canvas">{label} (CSV)</a></li>
        ))}
      </ul>
    </details>
  );
}

/** Alta como en la referencia: al guardar se crea también el negocio en el embudo (E02-S01 + X-07). */
function NewContactForm({ onCreated }: { onCreated: () => void }) {
  const pipelines = useQuery({ queryKey: ['pipelines'], queryFn: () => api<{ id: string; name: string }[]>('/api/v1/pipelines') });
  const [duplicates, setDuplicates] = useState<Duplicate[]>();
  const [pending, setPending] = useState<object>();
  const create = useMutation({
    mutationFn: (body: object) => api('/api/v1/contacts', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { setDuplicates(undefined); setPending(undefined); onCreated(); },
    onError: (error, body) => {
      if (error instanceof ApiError && error.code === 'DUPLICATE_CONTACT') {
        setDuplicates((error.body.duplicates as Duplicate[] | undefined) ?? []);
        setPending(body);
      }
    },
  });
  const [open, setOpen] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const text = (k: string) => String(form.get(k) ?? '').trim() || null;
    const pipelineId = text('pipelineId');
    create.mutate({
      name: text('name'), phone: text('phone'), email: text('email'), source: text('source'),
      priority: text('priority'), kind: text('kind') ?? 'person',
      tags: (text('tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean),
      ...(form.get('createDeal') === 'on' && pipelineId ? { createDeal: { pipelineId } } : {}),
    }, { onSuccess: () => formEl.reset() });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="mt-3 flex min-h-10 w-full items-center justify-between rounded-xl border border-line bg-surface px-4 text-xs font-semibold text-ink shadow-sm hover:bg-honey-soft">+ Nuevo cliente <span className="text-lg font-normal">＋</span></button>
      {open && <div role="dialog" aria-modal="true" aria-label="Nuevo cliente" className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-ink/60 p-4" onClick={() => setOpen(false)}>
        <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between bg-honey px-7 py-5">
            <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-lg bg-surface/40 text-2xl text-ink">＋</span><div><h2 className="text-lg font-semibold text-ink">Nuevo cliente</h2><p className="text-xs text-ink/70">Completa los datos para crear un cliente.</p></div></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="text-2xl leading-none text-ink/70 hover:text-ink">×</button>
          </div>
          <div className="min-h-0 overflow-y-auto px-7 py-6">
            <p className="mb-5 rounded-lg border border-info-soft bg-info-soft px-3 py-2 text-xs text-ink">Al guardar un cliente, también puedes crear su negocio en el embudo actual.</p>
            <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
              <Field label="Nombre" name="name" required />
              <Field label="Teléfono" name="phone" type="tel" placeholder="300 123 4567" />
              <Field label="Correo" name="email" type="email" />
              <Field label="Origen" name="source" placeholder="feria, referido, instagram…" />
              <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
                Prioridad
                <select name="priority" defaultValue="" className="h-11 rounded-lg border border-line bg-surface px-3">
                  <option value="">Sin prioridad</option>
                  {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
                Tipo de cliente
                <select name="kind" defaultValue="person" className="h-11 rounded-lg border border-line bg-surface px-3">
                  <option value="person">Persona</option>
                  <option value="company">Empresa</option>
                </select>
              </label>
              <Field label="Etiquetas" name="tags" placeholder="vip, referido" />
              <div className="flex flex-col gap-1.5">
                <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
                  <input type="checkbox" name="createDeal" defaultChecked className="size-4 accent-honey" /> Crear negocio en el embudo
                </label>
                <select name="pipelineId" aria-label="Embudo del negocio" className="h-11 rounded-lg border border-line bg-surface px-3">
                  {pipelines.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              {duplicates && <div className="sm:col-span-2"><Alert>Ya existe {duplicates.map((d) => `${d.name} (mismo ${d.matchedBy === 'phone' ? 'teléfono' : 'correo'})`).join(', ')}.{' '}<button type="button" onClick={() => pending && create.mutate({ ...pending, allowDuplicate: true })} className="font-medium underline">Crear de todas formas</button></Alert></div>}
              {create.isError && !duplicates && <div className="sm:col-span-2"><Alert>{create.error instanceof ApiError ? create.error.message : 'No pudimos guardar el cliente.'}</Alert></div>}
              <div className="flex justify-end gap-2 border-t border-line pt-5 sm:col-span-2"><button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-lg border border-line px-5 text-sm font-medium text-muted">Cancelar</button><Button type="submit" loading={create.isPending}>Crear cliente</Button></div>
            </form>
          </div>
        </div>
      </div>}
    </>
  );
}
