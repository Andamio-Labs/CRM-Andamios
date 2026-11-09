import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { type FormEvent, type ReactNode, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { useRegion } from '../../shared/i18n/use-region';
import { AppShell } from '../../shared/ui/app-shell';
import { Alert, Button, Field } from '../../shared/ui/form';
import { AlertIcon, CalendarIcon, CloseIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, PlusIcon, TasksIcon, VideoIcon } from '../../shared/ui/icons';
import { Badge, EmptyState, primaryButton, secondaryButton, Segmented } from '../../shared/ui/section';
import { duePresets, groupByWeek, groupMyTasks, weekOf } from './task-dates';
import { useDebouncedValue } from '../../shared/use-debounced-value';
import { authClient } from '../../shared/auth-client';
import { useTeamPresence } from '../team/presence';

interface Task {
  id: string;
  title: string;
  status: 'open' | 'done';
  dueAt: string | null;
  assigneeId: string | null;
  dealId: string | null;
  dealTitle: string | null;
  contactName: string | null;
  remindBeforeMinutes: number | null;
}
interface CalendarMeeting { id: string; title: string; startsAt: string; endsAt: string; joinUrl: string }
type View = 'mine' | 'all' | 'calendar';
type Status = 'open' | 'overdue' | 'done' | 'all';
type Assignment = 'all' | 'mine' | 'unassigned';

const VIEWS: [View, string][] = [['mine', 'Mis tareas'], ['all', 'Todas'], ['calendar', 'Calendario']];
const STATUS: [Status, string][] = [['open', 'Abiertas'], ['overdue', 'Vencidas'], ['done', 'Hechas'], ['all', 'Todas']];
const ASSIGNMENT: [Assignment, string][] = [['all', 'Todas'], ['mine', 'Mías'], ['unassigned', 'Sin asignar']];

/** Marca una tarea como hecha o pendiente y refresca listas, calendario y tablero. */
function useToggleTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (t: Task) => api(`/api/v1/tasks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ status: t.status === 'open' ? 'done' : 'open' }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** E06-S01/S02/S04 — Mis tareas del día, todas las de la empresa y calendario semanal con tareas y reuniones. */
export function TasksPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { view = 'mine' } = useSearch({ from: '/tasks' });
  const { region } = useRegion();
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const setView = (next: View) => void navigate({ to: '/tasks', search: next === 'mine' ? {} : { view: next }, replace: true });

  return (
    <AppShell title="Tareas" subtitle="Próximos pasos con responsable y fecha, para que ningún cliente se pierda." wide>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Vista" options={VIEWS} value={view} onChange={setView} />
        <button type="button" onClick={() => setNewTaskOpen(true)} className={primaryButton}><PlusIcon size={14} /> Nueva tarea</button>
      </div>
      <NewTaskForm open={newTaskOpen} onClose={() => setNewTaskOpen(false)} onCreated={() => { void queryClient.invalidateQueries({ queryKey: ['tasks'] }); setNewTaskOpen(false); }} timeZone={region.timeZone} />

      {view === 'mine' && <MyTasks onNew={() => setNewTaskOpen(true)} />}
      {view === 'all' && <AllTasks />}
      {view === 'calendar' && <WeekCalendar />}
    </AppShell>
  );
}

function MyTasks({ onNew }: { onNew: () => void }) {
  const { region } = useRegion();
  const tasks = useQuery({ queryKey: ['tasks', 'mine-open'], queryFn: () => api<Task[]>('/api/v1/tasks?status=open&assignment=mine') });
  if (tasks.isPending) return <p className="mt-6 text-sm text-muted">Cargando tus tareas…</p>;
  if (tasks.isError) return <div className="mt-6"><Alert>No pudimos cargar tus tareas.</Alert></div>;
  const groups = groupMyTasks(tasks.data, new Date(), region.timeZone);
  if (!tasks.data.length) {
    return (
      <div className="mt-6">
        <EmptyState icon={<TasksIcon size={14} />} title="No tienes tareas pendientes" action={<button type="button" onClick={onNew} className={secondaryButton}><PlusIcon size={14} /> Nueva tarea</button>}>
          Cuando te asignen un próximo paso aparecerá aquí, ordenado por fecha.
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="mt-5 flex flex-col gap-6">
      <dl className="grid grid-cols-3 gap-3 sm:max-w-xl">
        <Counter label="Atrasadas" value={groups.overdue.length} tone={groups.overdue.length ? 'danger' : 'muted'} />
        <Counter label="Para hoy" value={groups.today.length} tone={groups.today.length ? 'honey' : 'muted'} />
        <Counter label="Próximas" value={groups.upcoming.length + groups.someday.length} tone="muted" />
      </dl>
      <TaskGroup title="Atrasadas" tone="danger" items={groups.overdue} />
      <TaskGroup title="Hoy" items={groups.today} empty="Nada para hoy. Buen momento para adelantar lo de mañana." />
      <TaskGroup title="Próximas" items={groups.upcoming} />
      <TaskGroup title="Sin fecha" items={groups.someday} />
    </div>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone: 'danger' | 'honey' | 'muted' }) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'honey' ? 'text-ink' : 'text-muted';
  return (
    <div className={`rounded-xl border bg-surface px-4 py-3 shadow-sm ${tone === 'honey' ? 'border-honey/60' : 'border-line'}`}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className={`mt-1 text-2xl font-semibold tracking-tight ${color}`}>{value}</dd>
    </div>
  );
}

function TaskGroup({ title, items, tone, empty }: { title: string; items: Task[]; tone?: 'danger'; empty?: string }) {
  if (!items.length && !empty) return null;
  return (
    <section aria-label={title}>
      <h2 className={`flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide ${tone === 'danger' ? 'text-danger' : 'text-muted'}`}>
        {tone === 'danger' && <AlertIcon size={13} />}{title} <span className="font-normal">{items.length}</span>
      </h2>
      {items.length ? (
        <ul className="mt-2 flex flex-col gap-2">{items.map((t) => <TaskRow key={t.id} task={t} />)}</ul>
      ) : (
        <p className="mt-2 rounded-xl border border-dashed border-line px-4 py-3 text-xs text-muted">{empty}</p>
      )}
    </section>
  );
}

function TaskRow({ task: t }: { task: Task }) {
  const { date, time } = useRegion();
  const toggle = useToggleTask();
  const overdue = t.status === 'open' && t.dueAt !== null && Date.parse(t.dueAt) < Date.now();
  return (
    <li className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-sm transition hover:border-honey/60">
      <input type="checkbox" checked={t.status === 'done'} disabled={toggle.isPending} onChange={() => toggle.mutate(t)} aria-label={`Marcar "${t.title}" como ${t.status === 'open' ? 'hecha' : 'pendiente'}`} className="size-4 shrink-0 accent-honey" />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-semibold ${t.status === 'done' ? 'text-muted line-through' : 'text-ink'}`}>{t.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted">
          {t.dealId ? <Link to="/deals" search={{ deal: t.dealId, tab: 'tareas' }} className="font-medium text-ink underline-offset-2 hover:underline">{t.dealTitle}</Link> : t.dealTitle}
          {t.contactName && <>{t.dealTitle ? ' · ' : ''}{t.contactName}</>}
          {!t.assigneeId && ' · sin asignar'}
        </p>
      </div>
      {t.dueAt && (
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs ${overdue ? 'bg-danger-soft font-semibold text-danger' : 'bg-canvas text-muted'}`}>
          <ClockIcon size={12} /> {date(t.dueAt)} {time(t.dueAt)}
        </span>
      )}
    </li>
  );
}

function AllTasks() {
  const { region } = useRegion();
  const [status, setStatus] = useState<Status>('open');
  const [assignment, setAssignment] = useState<Assignment>('all');
  const tasks = useQuery({ queryKey: ['tasks', status, assignment], queryFn: () => api<Task[]>(`/api/v1/tasks?status=${status}&assignment=${assignment}`) });
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Segmented label="Estado" value={status} options={STATUS} onChange={setStatus} />
        <Segmented label="Asignación" value={assignment} options={ASSIGNMENT} onChange={setAssignment} />
      </div>
      {tasks.isPending && <p className="mt-4 text-sm text-muted">Cargando tareas…</p>}
      {tasks.isError && <div className="mt-4"><Alert>No pudimos cargar las tareas.</Alert></div>}
      {tasks.data?.length === 0 && <div className="mt-4"><EmptyState icon={<TasksIcon size={14} />} title="No hay tareas con estos filtros" /></div>}
      {tasks.data && groupByWeek(tasks.data, new Date(), region.timeZone).map((group) => (
        <section key={group.label} className="mt-5" aria-label={group.label}>
          <h2 className={`px-1 text-xs font-semibold uppercase tracking-wide ${group.label === 'Vencidas' ? 'text-danger' : 'text-muted'}`}>{group.label} <span className="font-normal">{group.items.length}</span></h2>
          <ul className="mt-2 flex flex-col gap-2">{group.items.map((t) => <TaskRow key={t.id} task={t} />)}</ul>
        </section>
      ))}
    </>
  );
}

type CalendarItem = { kind: 'task'; at: number; task: Task } | { kind: 'meeting'; at: number; meeting: CalendarMeeting };

/** E06-S04 — Semana de lunes a domingo con las tareas que vencen y las reuniones, en la zona de la empresa. */
function WeekCalendar() {
  const { region, time } = useRegion();
  const [offset, setOffset] = useState(0);
  const week = weekOf(new Date(), region.timeZone, offset);
  const range = `from=${encodeURIComponent(week.start.toISOString())}&to=${encodeURIComponent(week.end.toISOString())}`;
  const tasks = useQuery({ queryKey: ['tasks', 'calendar', week.start.toISOString()], queryFn: () => api<Task[]>(`/api/v1/tasks?status=all&${range}`) });
  const meetings = useQuery({ queryKey: ['meetings', 'range', week.start.toISOString()], queryFn: () => api<CalendarMeeting[]>(`/api/v1/meetings?scope=range&${range}`) });

  const dayFmt = new Intl.DateTimeFormat(region.locale, { timeZone: region.timeZone, weekday: 'short' });
  const numFmt = new Intl.DateTimeFormat(region.locale, { timeZone: region.timeZone, day: 'numeric' });
  const rangeFmt = new Intl.DateTimeFormat(region.locale, { timeZone: region.timeZone, day: 'numeric', month: 'short' });
  const lastDay = week.days[6]!;
  const todayStart = weekOf(new Date(), region.timeZone).days.find((d, i, all) => Date.now() >= d.getTime() && Date.now() < (all[i + 1]?.getTime() ?? Infinity))?.getTime();

  const columns: CalendarItem[][] = week.days.map(() => []);
  const dayIndex = (at: number) => week.days.findIndex((d, i) => at >= d.getTime() && at < (week.days[i + 1] ?? week.end).getTime());
  for (const task of tasks.data ?? []) {
    if (!task.dueAt) continue;
    const at = Date.parse(task.dueAt);
    columns[dayIndex(at)]?.push({ kind: 'task', at, task });
  }
  for (const meeting of meetings.data ?? []) {
    const at = Math.max(Date.parse(meeting.startsAt), week.start.getTime());
    columns[dayIndex(at)]?.push({ kind: 'meeting', at: Date.parse(meeting.startsAt), meeting });
  }
  columns.forEach((items) => items.sort((a, b) => a.at - b.at));
  const loading = tasks.isPending || meetings.isPending;

  return (
    <section aria-label="Calendario semanal" className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1 shadow-sm">
          <button type="button" onClick={() => setOffset((o) => o - 1)} aria-label="Semana anterior" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink"><ChevronLeftIcon size={16} /></button>
          <button type="button" onClick={() => setOffset(0)} disabled={offset === 0} className="min-h-9 rounded-lg px-3 text-xs font-semibold text-ink hover:bg-canvas disabled:text-muted disabled:hover:bg-transparent">Hoy</button>
          <button type="button" onClick={() => setOffset((o) => o + 1)} aria-label="Semana siguiente" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink"><ChevronRightIcon size={16} /></button>
        </div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><CalendarIcon size={15} /> {rangeFmt.format(week.start)} – {rangeFmt.format(lastDay)}</h2>
        {loading && <span className="text-xs text-muted">Cargando…</span>}
      </div>
      {(tasks.isError || meetings.isError) && <div className="mt-3"><Alert>No pudimos cargar toda la semana. Intenta de nuevo en un momento.</Alert></div>}

      <ol className="mt-3 grid gap-2 md:grid-cols-7">
        {week.days.map((day, i) => {
          const isToday = day.getTime() === todayStart;
          const items = columns[i]!;
          return (
            <li key={day.toISOString()} className={`flex min-h-32 flex-col rounded-xl border bg-surface p-2 shadow-sm md:min-h-72 ${isToday ? 'border-honey ring-1 ring-honey/40' : 'border-line'}`}>
              <p className="flex items-baseline justify-between px-1 pb-2">
                <span className={`text-[11px] font-semibold uppercase tracking-wide ${isToday ? 'text-ink' : 'text-muted'}`}>{dayFmt.format(day)}</span>
                <span className={`grid size-7 place-items-center rounded-full text-sm font-semibold ${isToday ? 'bg-honey text-on-honey' : 'text-ink'}`}>{numFmt.format(day)}</span>
              </p>
              <ul className="flex flex-1 flex-col gap-1.5">
                {items.map((item) => item.kind === 'task'
                  ? <CalendarTask key={`t-${item.task.id}`} task={item.task} label={time(item.task.dueAt!)} />
                  : <CalendarEntry key={`m-${item.meeting.id}`} icon={<VideoIcon size={12} />} label={time(item.meeting.startsAt)}>
                      <Link to="/meetings" search={{ m: item.meeting.id }} className="line-clamp-2 break-words font-medium text-ink hover:underline">{item.meeting.title}</Link>
                    </CalendarEntry>)}
                {!items.length && !loading && <li className="mt-auto hidden px-1 pb-1 text-[11px] text-muted/70 md:block">Libre</li>}
              </ul>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1"><Badge tone="info"><VideoIcon size={10} /> Reunión</Badge></span>
        <span className="inline-flex items-center gap-1"><Badge tone="honey"><TasksIcon size={10} /> Tarea</Badge></span>
        Las horas van en la zona de tu empresa.
      </p>
    </section>
  );
}

function CalendarEntry({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <li className="rounded-lg border-l-2 border-info bg-info-soft px-2 py-1.5 text-xs">
      <p className="flex items-center gap-1 text-[10px] font-semibold text-muted">{icon}{label}</p>
      {children}
    </li>
  );
}

function CalendarTask({ task: t, label }: { task: Task; label: string }) {
  const toggle = useToggleTask();
  const done = t.status === 'done';
  const overdue = !done && t.dueAt !== null && Date.parse(t.dueAt) < Date.now();
  return (
    <li className={`rounded-lg border-l-2 px-2 py-1.5 text-xs ${done ? 'border-line bg-canvas opacity-70' : overdue ? 'border-danger bg-danger-soft' : 'border-honey bg-honey-soft'}`}>
      <p className={`text-[10px] font-semibold ${overdue ? 'text-danger' : 'text-muted'}`}>{label}{overdue && ' · atrasada'}</p>
      <label className="mt-0.5 flex items-start gap-1.5">
        <input type="checkbox" checked={done} disabled={toggle.isPending} onChange={() => toggle.mutate(t)} aria-label={`Marcar "${t.title}" como ${done ? 'pendiente' : 'hecha'}`} className="mt-0.5 size-3.5 shrink-0 accent-honey" />
        <span className={`min-w-0 break-words font-medium ${done ? 'text-muted line-through' : 'text-ink'}`}>{t.title}</span>
      </label>
      {t.dealId && <Link to="/deals" search={{ deal: t.dealId, tab: 'tareas' }} className="mt-0.5 block truncate pl-5 text-[10px] text-muted hover:text-ink hover:underline">{t.dealTitle}</Link>}
    </li>
  );
}

interface DealOption { id: string; title: string; contact: { name: string } | null }

/** Toda tarea va atada a un negocio (como en la referencia); el backend acepta también contacto. */
function NewTaskForm({ open, onClose, onCreated, timeZone }: { open: boolean; onClose: () => void; onCreated: () => void; timeZone: string }) {
  const [dealQuery, setDealQuery] = useState('');
  const [deal, setDeal] = useState<DealOption>();
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState<string>();
  const me = authClient.useSession().data?.user.id;
  const team = useTeamPresence();
  const q = useDebouncedValue(dealQuery.trim());
  const deals = useQuery({ queryKey: ['deal-options', q], queryFn: () => api<{ items: DealOption[] }>(`/api/v1/deals?q=${encodeURIComponent(q)}&limit=8`), enabled: q.length >= 2 && !deal });
  const create = useMutation({
    mutationFn: (body: object) => api('/api/v1/tasks', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { setDeal(undefined); setDealQuery(''); setDue(''); setAssignee(undefined); onCreated(); },
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
      assigneeId: (assignee ?? me) || null,
      dueAt: due ? new Date(due).toISOString() : undefined,
      remindBeforeMinutes: remind === '' ? undefined : Number(remind),
    }, { onSuccess: () => formEl.reset() });
  }

  const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Nueva tarea" className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-scrim/60 p-4" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-surface shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-line px-5 py-4"><div><h2 className="text-base font-semibold text-ink">Nueva tarea</h2><p className="mt-1 text-xs text-muted">La tarea quedará vinculada al negocio seleccionado.</p></div><button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink"><CloseIcon size={16} /></button></div>
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
        Responsable
        <select value={assignee ?? me ?? ''} onChange={(e) => setAssignee(e.target.value)} className="h-11 rounded-lg border border-line bg-surface px-3">
          <option value="">Sin asignar</option>
          {team.data?.map((p) => <option key={p.userId} value={p.userId}>{p.userId === me ? `${p.name} (tú)` : p.name}</option>)}
        </select>
      </label>
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
