import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { useRegion } from '../../shared/i18n/use-region';
import { AppShell } from '../../shared/ui/app-shell';
import { Alert, Button, Field } from '../../shared/ui/form';
import { duePresets, groupByWeek } from './task-dates';
import { useDebouncedValue } from '../../shared/use-debounced-value';

interface Task {
  id: string;
  title: string;
  status: 'open' | 'done';
  dueAt: string | null;
  assigneeId: string | null;
  dealTitle: string | null;
  contactName: string | null;
  remindBeforeMinutes: number | null;
}
type Status = 'open' | 'overdue' | 'done' | 'all';
type Assignment = 'all' | 'mine' | 'unassigned';

const STATUS: [Status, string][] = [['open', 'Abiertas'], ['overdue', 'Vencidas'], ['done', 'Hechas'], ['all', 'Todas']];
const ASSIGNMENT: [Assignment, string][] = [['all', 'Todas'], ['mine', 'Mías'], ['unassigned', 'Sin asignar']];

/** E06-S01/S02 — Tareas con filtros, agrupadas por semana y con plantillas rápidas de vencimiento. */
export function TasksPage() {
  const queryClient = useQueryClient();
  const { date, time, region } = useRegion();
  const [status, setStatus] = useState<Status>('open');
  const [assignment, setAssignment] = useState<Assignment>('all');
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const tasks = useQuery({ queryKey: ['tasks', status, assignment], queryFn: () => api<Task[]>(`/api/v1/tasks?status=${status}&assignment=${assignment}`) });
  const toggle = useMutation({
    mutationFn: (t: Task) => api(`/api/v1/tasks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ status: t.status === 'open' ? 'done' : 'open' }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  return (
    <AppShell title="Tareas" subtitle="Próximos pasos con responsable y fecha, para que ningún cliente se pierda." wide>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-ink">Tareas de la organización</h2><p className="text-xs text-muted">Todas las tareas de tus negocios en un solo lugar.</p></div>
        <button type="button" onClick={() => setNewTaskOpen(true)} className="min-h-10 rounded-lg bg-honey px-4 text-xs font-semibold text-ink shadow-sm hover:brightness-95">+ Nueva tarea</button>
      </div>
      <NewTaskForm open={newTaskOpen} onClose={() => setNewTaskOpen(false)} onCreated={() => { void queryClient.invalidateQueries({ queryKey: ['tasks'] }); setNewTaskOpen(false); }} timeZone={region.timeZone} />

      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-2 shadow-sm">
        <Tabs label="Estado" value={status} options={STATUS} onChange={setStatus} />
        <Tabs label="Asignación" value={assignment} options={ASSIGNMENT} onChange={setAssignment} />
      </div>

      {tasks.isPending && <p className="mt-4 text-muted">Cargando tareas…</p>}
      {tasks.isError && <div className="mt-4"><Alert>No pudimos cargar las tareas.</Alert></div>}
      {tasks.data?.length === 0 && <p className="mt-4 rounded-xl border border-line bg-surface px-4 py-8 text-center text-muted">No hay tareas con estos filtros.</p>}
      {tasks.data && groupByWeek(tasks.data, new Date(), region.timeZone).map((group) => (
       <section key={group.label} className="mt-4">
          <h2 className={`px-1 text-xs font-semibold uppercase tracking-wide ${group.label === 'Vencidas' ? 'text-danger' : 'text-muted'}`}>{group.label} <span className="font-normal">{group.items.length}</span></h2>
          <ul className="mt-2 flex flex-col gap-2">
            {group.items.map((t) => (
               <li key={t.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-sm transition hover:border-honey/60">
                 <input type="checkbox" checked={t.status === 'done'} onChange={() => toggle.mutate(t)} aria-label={`Marcar "${t.title}" como ${t.status === 'open' ? 'hecha' : 'pendiente'}`} className="size-4 accent-honey" />
                 <div className="min-w-0 flex-1">
                   <p className={`truncate text-sm font-semibold ${t.status === 'done' ? 'text-muted line-through' : 'text-ink'}`}>{t.title}</p>
                   <p className="mt-0.5 truncate text-xs text-muted">{[t.dealTitle, t.contactName].filter(Boolean).join(' · ')}{t.assigneeId ? '' : ' · sin asignar'}</p>
                 </div>
                 {t.dueAt && <span className="shrink-0 rounded-md bg-canvas px-2 py-1 text-xs text-muted">{date(t.dueAt)} {time(t.dueAt)}</span>}
                 <span className="text-muted">›</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </AppShell>
  );
}

function Tabs<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 rounded-lg bg-canvas p-1">
      {options.map(([key, text]) => (
         <button key={key} role="tab" aria-selected={value === key} onClick={() => onChange(key)} className={`min-h-9 rounded-md px-3 text-xs ${value === key ? 'bg-honey font-semibold text-ink shadow-sm' : 'text-muted'}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

interface DealOption { id: string; title: string; contact: { name: string } | null }

/** Toda tarea va atada a un negocio (como en la referencia); el backend acepta también contacto. */
function NewTaskForm({ open, onClose, onCreated, timeZone }: { open: boolean; onClose: () => void; onCreated: () => void; timeZone: string }) {
  const [dealQuery, setDealQuery] = useState('');
  const [deal, setDeal] = useState<DealOption>();
  const [due, setDue] = useState('');
  const q = useDebouncedValue(dealQuery.trim());
  const deals = useQuery({ queryKey: ['deal-options', q], queryFn: () => api<{ items: DealOption[] }>(`/api/v1/deals?q=${encodeURIComponent(q)}&limit=8`), enabled: q.length >= 2 && !deal });
  const create = useMutation({
    mutationFn: (body: object) => api('/api/v1/tasks', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { setDeal(undefined); setDealQuery(''); setDue(''); onCreated(); },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    if (!deal) return;
    const remind = String(form.get('remind'));
    create.mutate({
      title: String(form.get('title')),
      dealId: deal.id,
      dueAt: due ? new Date(due).toISOString() : undefined,
      remindBeforeMinutes: remind === '' ? undefined : Number(remind),
    }, { onSuccess: () => formEl.reset() });
  }

  const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Nueva tarea" className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-ink/60 p-4" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-surface shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-line px-5 py-4"><div><h2 className="text-base font-semibold text-ink">Nueva tarea</h2><p className="mt-1 text-xs text-muted">La tarea quedará vinculada al negocio seleccionado.</p></div><button type="button" onClick={onClose} aria-label="Cerrar" className="text-2xl leading-none text-muted hover:text-ink">×</button></div>
        <form onSubmit={onSubmit} className="grid gap-3 p-5 sm:grid-cols-2">
      <Field label="Qué hacer" name="title" required placeholder="Llamar para confirmar la cotización" />
      <div className="relative flex flex-col gap-1.5">
         <label htmlFor="deal-search" className="text-sm font-medium text-ink">Negocio</label>
        {deal ? (
          <p className="flex min-h-11 items-center justify-between rounded-lg border border-line px-3">
            <span className="truncate">{deal.title}</span>
            <button type="button" onClick={() => setDeal(undefined)} className="min-h-11 text-sm text-muted underline">Cambiar</button>
          </p>
        ) : (
          <input id="deal-search" value={dealQuery} onChange={(e) => setDealQuery(e.target.value)} placeholder="Busca por negocio o cliente" className="h-11 rounded-lg border border-line bg-surface px-3" autoComplete="off" />
        )}
        {!deal && Boolean(deals.data?.items.length) && (
          <ul role="listbox" className="absolute top-full z-10 mt-1 w-full rounded-lg border border-line bg-surface shadow-lg">
            {deals.data!.items.map((d) => (
              <li key={d.id}><button type="button" onClick={() => setDeal(d)} className="min-h-11 w-full px-3 text-left hover:bg-canvas">{d.title} <span className="text-sm text-muted">{d.contact?.name}</span></button></li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="due" className="text-sm font-medium text-ink">Vence</label>
        <input id="due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="h-11 rounded-lg border border-line bg-surface px-3" />
        <div className="flex flex-wrap gap-1">
          {duePresets(new Date(), timeZone).map((p) => (
            <button key={p.label} type="button" onClick={() => setDue(toLocalInput(p.date))} className="min-h-11 rounded-md border border-line px-2 text-sm text-ink">{p.label}</button>
          ))}
        </div>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        Recordarme
        <select name="remind" defaultValue="15" className="h-11 rounded-lg border border-line bg-surface px-3">
          <option value="">Sin recordatorio</option>
          <option value="0">Al vencer</option>
          <option value="15">15 minutos antes</option>
          <option value="60">1 hora antes</option>
          <option value="1440">1 día antes</option>
        </select>
      </label>
      {!deal && create.isIdle && <p className="text-sm text-muted sm:col-span-2">Elige el negocio al que pertenece la tarea.</p>}
      {create.isError && <div className="sm:col-span-2"><Alert>{create.error instanceof ApiError ? create.error.message : 'No pudimos crear la tarea.'}</Alert></div>}
       <div className="flex justify-end gap-2 border-t border-line pt-4 sm:col-span-2"><button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-line px-4 text-sm font-medium text-muted">Cancelar</button><Button type="submit" loading={create.isPending} disabled={!deal}>Crear tarea</Button></div>
        </form>
      </div>
    </div>
  );
}
