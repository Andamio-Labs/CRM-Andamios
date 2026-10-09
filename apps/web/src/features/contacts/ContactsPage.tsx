import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { type FormEvent, Fragment, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { authClient } from '../../shared/auth-client';
import { useRegion } from '../../shared/i18n/use-region';
import { AppShell } from '../../shared/ui/app-shell';
import { Alert, Button, Field } from '../../shared/ui/form';
import { ContactConsents } from './ContactConsents';
import { ContactPrivacy } from './ContactPrivacy';
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
  // Solo propietario y admin ven el equipo: el mismo 403 indica quién atiende derechos del titular.
  const canManagePrivacy = useQuery({ queryKey: ['members'], queryFn: () => api<{ userId: string; role: string }[]>('/api/v1/members'), retry: false, staleTime: 60_000 }).isSuccess;
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
      <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-xl border border-honey/50 bg-honey-soft text-lg text-honey">♙</span>
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-ink">Clientes <span className="ml-1 text-sm font-medium text-honey">{stats.data?.total ?? '…'}</span></h2>
              <p className="mt-0.5 text-xs text-muted">Gestiona contactos y oportunidades desde un solo lugar.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-xs text-ink">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="size-4 accent-honey" /> Mis clientes
            </label>
            <button type="button" onClick={() => setImporting((v) => !v)} aria-expanded={importing} className="min-h-10 rounded-lg border border-line px-3 text-xs font-semibold text-ink transition hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey">Importar</button>
            <ExportMenu />
            <NewContactForm onCreated={refresh} />
          </div>
        </div>
      </section>

      {stats.data && (
        <dl className="my-4 flex flex-wrap items-center gap-x-8 gap-y-2 px-1">
          <Stat label="total de clientes" value={String(stats.data.total)} />
          <Stat label="con teléfono" value={String(stats.data.withPhone)} />
          <Stat label="origen principal" value={stats.data.topSource ? stats.data.topSource.source.replace('sin_origen', 'Sin origen') : 'Sin datos'} />
        </dl>
      )}

      <div className="mb-4 flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2.5 shadow-sm">
        <span aria-hidden className="text-xl text-muted">⌕</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, teléfono..." aria-label="Buscar clientes" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" />
        {searching && <span className="text-xs text-muted">Buscando</span>}
      </div>

      {importing && <ImportWizard onDone={refresh} />}

      {list.isPending && <p className="mt-4 text-muted">Cargando clientes…</p>}
      {list.isError && <div className="mt-4"><Alert>No pudimos cargar los clientes.</Alert></div>}
      {list.data?.length === 0 && (
        <p className="mt-4 rounded-xl border border-line bg-surface px-4 py-8 text-center text-muted">{searching ? 'Sin resultados.' : 'Todavía no hay clientes. Crea el primero o importa un CSV.'}</p>
      )}
      {Boolean(list.data?.length) && (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-sm">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead className="border-b border-line bg-raised text-[10px] uppercase tracking-wide text-honey">
              <tr><th scope="col" className="w-12 px-4 py-3"><span className="sr-only">Seleccionar</span><span aria-hidden>○</span></th>{['Cliente', 'Contacto', 'Origen', 'Prioridad', 'Responsable', 'Fecha'].map((h) => <th key={h} scope="col" className="px-4 py-3 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.data!.map((c) => (
                <Fragment key={c.id}>
                  <tr className="transition-colors hover:bg-raised/60">
                    <td className="px-4 py-3 text-honey">○</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-honey-soft text-honey">♙</span><div className="min-w-0"><button onClick={() => setOpenId(openId === c.id ? undefined : c.id)} aria-expanded={openId === c.id} className="block max-w-full truncate text-left text-sm font-semibold text-ink underline-offset-2 hover:underline">{c.name}</button>{c.kind === 'company' && <span className="text-[11px] text-muted">Empresa</span>}</div></div>
                    </td>
                    <td className="px-4 py-3"><div className="flex flex-col gap-0.5 text-xs text-muted">{c.phone ? <span className="text-ink">⌕ {c.phone}</span> : <span>Sin teléfono</span>}{c.email ? <span className="truncate">✉ {c.email}</span> : <span>Sin correo</span>}</div></td>
                    <td className="px-4 py-3 text-xs text-muted">{c.source ?? 'Sin origen'}</td>
                    <td className="px-4 py-3">{c.priority ? <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${PRIORITY[c.priority]!.className}`}>{PRIORITY[c.priority]!.label}</span> : <span className="text-xs text-muted">Sin prioridad</span>}</td>
                    <td className="px-4 py-3 text-xs text-muted"><button type="button" className="grid size-8 place-items-center rounded-full border border-dashed border-line text-sm text-muted hover:border-honey hover:text-honey" aria-label={`Asignar responsable a ${c.name}`}>＋</button></td>
                    <td className="px-4 py-3 text-xs text-muted">{c.createdAt ? date(c.createdAt) : ''}</td>
                  </tr>
                  {openId === c.id && <tr><td colSpan={7} className="px-3 pb-4"><div className="flex flex-col gap-5"><ContactTimeline contactId={c.id} /><ContactConsents contactId={c.id} />{canManagePrivacy && <ContactPrivacy contactId={c.id} contactName={c.name} />}</div></td></tr>}
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
    onSuccess: () => { setDuplicates(undefined); setPending(undefined); setOpen(false); onCreated(); },
    onError: (error, body) => {
      if (error instanceof ApiError && error.code === 'DUPLICATE_CONTACT') {
        setDuplicates((error.body.duplicates as Duplicate[] | undefined) ?? []);
        setPending(body);
      }
    },
  });
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const firstField = dialogRef.current?.querySelector<HTMLInputElement>('input[name="name"]');
    firstField?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

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
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-honey px-4 text-xs font-semibold text-ink shadow-sm transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey focus-visible:ring-offset-2 focus-visible:ring-offset-surface">＋ Añadir</button>
      {open && <div role="dialog" aria-modal="true" aria-labelledby="new-contact-title" className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/75 p-3 backdrop-blur-sm sm:p-6" onClick={() => setOpen(false)}>
        <div ref={dialogRef} className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl sm:max-h-[calc(100dvh-3rem)]" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between bg-honey px-5 py-5 sm:px-7">
            <div className="flex items-center gap-3"><span aria-hidden className="grid size-10 place-items-center rounded-lg bg-ink/10 text-2xl text-ink">＋</span><div><h2 id="new-contact-title" className="text-lg font-semibold text-ink">Nuevo cliente</h2><p className="text-xs text-ink/75">Completa los datos para crear un contacto.</p></div></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar ventana de nuevo cliente" className="grid size-10 place-items-center rounded-lg text-2xl leading-none text-ink/70 hover:bg-ink/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink">×</button>
          </div>
          <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
            <p className="mb-5 rounded-lg border border-blue-400/30 bg-info-soft px-3 py-2 text-xs text-ink">Al guardar un cliente, puedes crear también su negocio en el embudo seleccionado.</p>
            <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
              <Field label="Nombre" name="name" required />
              <Field label="Teléfono" name="phone" type="tel" placeholder="300 123 4567" />
              <Field label="Correo" name="email" type="email" />
              <Field label="Origen" name="source" placeholder="feria, referido, instagram…" />
              <label className="flex flex-col gap-1.5 text-sm font-medium text-muted">
                Prioridad
                <select name="priority" defaultValue="" className="h-11 rounded-lg border border-line bg-raised px-3 text-sm text-ink outline-none focus:border-honey focus:ring-2 focus:ring-honey/30">
                  <option value="">Sin prioridad</option>
                  {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-muted">
                Tipo de cliente
                <select name="kind" defaultValue="person" className="h-11 rounded-lg border border-line bg-raised px-3 text-sm text-ink outline-none focus:border-honey focus:ring-2 focus:ring-honey/30">
                  <option value="person">Persona</option>
                  <option value="company">Empresa</option>
                </select>
              </label>
              <Field label="Etiquetas" name="tags" placeholder="vip, referido" />
              <div className="flex flex-col gap-1.5">
                <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
                  <input type="checkbox" name="createDeal" defaultChecked className="size-4 accent-honey" /> Crear negocio en el embudo
                </label>
                <select name="pipelineId" aria-label="Embudo del negocio" className="h-11 rounded-lg border border-line bg-raised px-3 text-sm text-ink outline-none focus:border-honey focus:ring-2 focus:ring-honey/30">
                  {pipelines.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  {!pipelines.data?.length && <option value="">Sin embudos disponibles</option>}
                </select>
              </div>
              {duplicates && <div className="sm:col-span-2"><Alert>Ya existe {duplicates.map((d) => `${d.name} (mismo ${d.matchedBy === 'phone' ? 'teléfono' : 'correo'})`).join(', ')}.{' '}<button type="button" onClick={() => pending && create.mutate({ ...pending, allowDuplicate: true })} className="font-medium underline">Crear de todas formas</button></Alert></div>}
              {create.isError && !duplicates && <div className="sm:col-span-2"><Alert>{create.error instanceof ApiError ? create.error.message : 'No pudimos guardar el cliente.'}</Alert></div>}
              <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 sm:col-span-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-lg border border-line px-5 text-sm font-medium text-muted hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey">Cancelar</button><Button type="submit" loading={create.isPending}>＋ Crear cliente</Button></div>
            </form>
          </div>
        </div>
      </div>}
    </>
  );
}
