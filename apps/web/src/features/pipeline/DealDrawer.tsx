import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { authClient } from '../../shared/auth-client';
import { useRegion } from '../../shared/i18n/use-region';
import { Alert } from '../../shared/ui/form';
import { CalendarIcon, ChatIcon, CloseIcon, HandIcon, PlusIcon, SparklesIcon, TrophyIcon, UsersIcon, VideoIcon } from '../../shared/ui/icons';
import { Badge, type BadgeTone, inputClass, labelClass, primaryButton, secondaryButton, Segmented, textareaClass } from '../../shared/ui/section';
import { useTeamChats } from '../chat/chat-api';
import { useTeamPresence } from '../team/presence';
import { daysInStage, describeEvent, type DealEvent } from './deal-format';

interface Stage { id: string; name: string; color: string }
interface Pipeline { id: string; name: string; stages: Stage[] }
interface DealDetail {
  id: string;
  title: string;
  value: number;
  currency: string;
  probability: number | null;
  expectedCloseDate: string | null;
  ownerId: string | null;
  source: string | null;
  description: string | null;
  status: 'open' | 'won' | 'lost';
  stageId: string;
  pipelineId: string;
  createdAt: string;
  stageEnteredAt: string;
  closedAt: string | null;
  closeNote: string | null;
  contact: { id: string; name: string; phone: string | null } | null;
}
interface DealTask { id: string; title: string; status: 'open' | 'done'; dueAt: string | null; assigneeId: string | null }
interface DealMeeting { id: string; title: string; startsAt: string; endsAt: string; joinUrl: string }
interface CloseReason { id: string; label: string; outcome: 'won' | 'lost'; active: boolean }

export type DrawerTab = 'resumen' | 'tareas' | 'reuniones' | 'historial' | 'ia';
const TABS: [DrawerTab, string][] = [['resumen', 'Resumen'], ['tareas', 'Tareas'], ['reuniones', 'Reuniones'], ['historial', 'Historial'], ['ia', '✦ IA']];
const STATUS: Record<DealDetail['status'], [string, BadgeTone]> = { open: ['Abierto', 'info'], won: ['Ganado', 'success'], lost: ['Perdido', 'danger'] };

const errorText = (error: unknown, fallback: string) => (error instanceof ApiError && error.status < 500 ? error.message : fallback);

/** Ficha del negocio: se abre desde la tarjeta del embudo o con /deals?deal=<id> (enlaces de avisos y chats). */
export function DealDrawer({ dealId, tab, poolOn, onTab, onClose }: {
  dealId: string;
  tab: DrawerTab;
  poolOn: boolean;
  onTab: (tab: DrawerTab) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { money, date } = useRegion();
  const myId = authClient.useSession().data?.user.id;
  const deal = useQuery({ queryKey: ['deal', dealId], queryFn: () => api<DealDetail>(`/api/v1/deals/${dealId}`), retry: false });
  const pipelines = useQuery({ queryKey: ['pipelines'], queryFn: () => api<Pipeline[]>('/api/v1/pipelines') });
  const [closing, setClosing] = useState<'won' | 'lost'>();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['deal', dealId] }),
    queryClient.invalidateQueries({ queryKey: ['deal-events', dealId] }),
    queryClient.invalidateQueries({ queryKey: ['board'] }),
    queryClient.invalidateQueries({ queryKey: ['deal-list'] }),
  ]);
  const move = useMutation({ mutationFn: (stageId: string) => api(`/api/v1/deals/${dealId}/move`, { method: 'POST', body: JSON.stringify({ stageId }) }), onSuccess: refresh });
  const reopen = useMutation({ mutationFn: () => api(`/api/v1/deals/${dealId}/reopen`, { method: 'POST' }), onSuccess: refresh });
  const claim = useMutation({ mutationFn: () => api(`/api/v1/deals/${dealId}/claim`, { method: 'POST' }), onSuccess: refresh });

  const d = deal.data;
  const stages = pipelines.data?.find((p) => p.id === d?.pipelineId)?.stages ?? [];
  const stage = stages.find((s) => s.id === d?.stageId);
  const stalled = d && d.status === 'open' ? daysInStage(d.stageEnteredAt) : 0;
  const actionError = move.error ?? reopen.error ?? claim.error;

  return (
    <div role="dialog" aria-modal="true" aria-label={d ? `Negocio ${d.title}` : 'Negocio'} className="fixed inset-0 z-40 flex justify-end bg-scrim/50" onClick={onClose}>
      <aside className="flex h-full w-[min(40rem,100vw)] flex-col bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="border-b border-line px-5 pb-3 pt-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {deal.isPending && <p className="text-sm text-muted">Cargando negocio…</p>}
              {deal.isError && <p className="text-sm text-danger">Este negocio no existe o ya no lo puedes ver.</p>}
              {d && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS[d.status][1]}>{STATUS[d.status][0]}</Badge>
                    {stalled >= 3 && <Badge tone="honey" title="Días desde que entró a la etapa">{stalled} días en la etapa</Badge>}
                    {!d.ownerId && poolOn && <Badge tone="info">En el pool</Badge>}
                  </div>
                  <h2 className="mt-1.5 truncate text-lg font-semibold tracking-tight text-ink">{d.title}</h2>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span className="text-base font-semibold text-ink">{money(d.value, d.currency)}</span>
                    {d.contact && <span className="inline-flex items-center gap-1"><UsersIcon size={13} /> {d.contact.name}</span>}
                    <span>Creado el {date(d.createdAt)}</span>
                  </p>
                </>
              )}
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar ficha" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink"><CloseIcon size={18} /></button>
          </div>
          {d && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {d.status === 'open' ? (
                <>
                  <label className="sr-only" htmlFor="deal-stage">Etapa</label>
                  <select id="deal-stage" value={d.stageId} disabled={move.isPending} onChange={(e) => move.mutate(e.target.value)} className="h-9 rounded-lg border border-line bg-surface px-2 text-xs font-medium text-ink">
                    {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button type="button" onClick={() => setClosing('won')} className={`${primaryButton} min-h-9`}><TrophyIcon size={14} /> Ganado</button>
                  <button type="button" onClick={() => setClosing('lost')} className={`${secondaryButton} min-h-9`}>Perdido</button>
                </>
              ) : (
                <>
                  <span className="text-xs text-muted">{d.status === 'won' ? 'Ganado' : 'Perdido'}{d.closedAt ? ` el ${date(d.closedAt)}` : ''}{stage ? ` · estaba en ${stage.name}` : ''}</span>
                  <button type="button" onClick={() => reopen.mutate()} disabled={reopen.isPending} className={`${secondaryButton} min-h-9`}>Reabrir</button>
                </>
              )}
              {poolOn && !d.ownerId && d.status === 'open' && (
                <button type="button" onClick={() => claim.mutate()} disabled={claim.isPending} className={`${secondaryButton} min-h-9`}><HandIcon size={14} /> Tomar</button>
              )}
              <DealChatButton deal={d} myId={myId} />
            </div>
          )}
          {closing && d && <CloseForm dealId={d.id} outcome={closing} onDone={() => { setClosing(undefined); void refresh(); }} onCancel={() => setClosing(undefined)} />}
          {actionError && <div className="mt-2"><Alert>{errorText(actionError, 'No pudimos guardar el cambio.')}</Alert></div>}
          <div className="mt-3 -mb-px overflow-x-auto">
            <Segmented label="Secciones del negocio" options={TABS} value={tab} onChange={onTab} />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {d && tab === 'resumen' && <SummaryTab deal={d} onSaved={refresh} />}
          {d && tab === 'tareas' && <TasksTab deal={d} />}
          {d && tab === 'reuniones' && <MeetingsTab deal={d} myId={myId} />}
          {d && tab === 'historial' && <HistoryTab deal={d} stages={stages} />}
          {d && tab === 'ia' && <InsightsTab deal={d} />}
        </div>
      </aside>
    </div>
  );
}

/** Chat del negocio: abre el grupo que ya existe o crea uno con su responsable. */
function DealChatButton({ deal, myId }: { deal: DealDetail; myId: string | undefined }) {
  const navigate = useNavigate();
  const chats = useTeamChats();
  const existing = chats.data?.find((c) => c.dealId === deal.id);
  const create = useMutation({
    mutationFn: () => api<{ id: string }>('/api/v1/team-chats', { method: 'POST', body: JSON.stringify({ userIds: [deal.ownerId], dealId: deal.id }) }),
    onSuccess: (chat) => navigate({ to: '/team-chat', search: { c: chat.id } }),
  });
  if (existing) return <Link to="/team-chat" search={{ c: existing.id }} className={`${secondaryButton} min-h-9`}><ChatIcon size={14} /> Chat del negocio</Link>;
  const canCreate = Boolean(deal.ownerId && deal.ownerId !== myId);
  return (
    <button type="button" onClick={() => create.mutate()} disabled={!canCreate || create.isPending} title={canCreate ? 'Abre un chat con el responsable sobre este negocio' : 'Para conversar sobre el negocio, asígnale un responsable distinto de ti o crea un grupo desde el chat'} className={`${secondaryButton} min-h-9`}>
      <ChatIcon size={14} /> Chat del negocio
    </button>
  );
}

function CloseForm({ dealId, outcome, onDone, onCancel }: { dealId: string; outcome: 'won' | 'lost'; onDone: () => void; onCancel: () => void }) {
  const reasons = useQuery({ queryKey: ['close-reasons'], queryFn: () => api<CloseReason[]>('/api/v1/close-reasons'), staleTime: 5 * 60_000 });
  const options = reasons.data?.filter((r) => r.outcome === outcome && r.active) ?? [];
  const close = useMutation({
    mutationFn: (body: object) => api(`/api/v1/deals/${dealId}/close`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: onDone,
  });
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const note = String(form.get('note')).trim();
    close.mutate({ outcome, reasonId: String(form.get('reasonId')), ...(note ? { note } : {}) });
  }
  return (
    <form onSubmit={onSubmit} className={`mt-3 grid gap-3 rounded-xl border p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end ${outcome === 'won' ? 'border-success/40 bg-success-soft' : 'border-danger/40 bg-danger-soft'}`}>
      <label className={labelClass}>
        {outcome === 'won' ? '¿Por qué lo ganaste?' : '¿Por qué se perdió?'}
        <select name="reasonId" required className={inputClass}>
          {options.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>
      <label className={labelClass}>
        Nota (opcional)
        <input name="note" maxLength={1000} placeholder={outcome === 'won' ? 'Qué funcionó' : 'Qué aprendimos'} className={inputClass} />
      </label>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className={`${secondaryButton} min-h-10`}>Cancelar</button>
        <button type="submit" disabled={close.isPending || !options.length} className={`${primaryButton} min-h-10`}>{outcome === 'won' ? 'Marcar ganado' : 'Marcar perdido'}</button>
      </div>
      {close.isError && <div className="sm:col-span-3"><Alert>{errorText(close.error, 'No pudimos cerrar el negocio.')}</Alert></div>}
    </form>
  );
}

const INTEREST: [string, string][] = [['', 'Sin definir'], ['25', 'Frío'], ['50', 'Tibio'], ['75', 'Caliente']];

function SummaryTab({ deal, onSaved }: { deal: DealDetail; onSaved: () => void }) {
  const team = useTeamPresence();
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (body: object) => api(`/api/v1/deals/${deal.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    },
  });
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '').trim() || null;
    const probability = String(form.get('probability'));
    save.mutate({
      title: String(form.get('title')).trim(),
      value: Number(form.get('value') || 0),
      ownerId: text('ownerId'),
      expectedCloseDate: text('expectedCloseDate'),
      probability: probability ? Number(probability) : null,
      source: text('source'),
      description: text('description'),
    });
  }
  return (
    <form key={deal.id} onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <label className={`${labelClass} sm:col-span-2`}>
        Nombre del negocio
        <input name="title" required maxLength={160} defaultValue={deal.title} className={inputClass} />
      </label>
      <label className={labelClass}>
        Valor ({deal.currency})
        <input name="value" type="number" min={0} step="any" defaultValue={deal.value} className={inputClass} />
      </label>
      <label className={labelClass}>
        Responsable
        <select name="ownerId" defaultValue={deal.ownerId ?? ''} className={inputClass}>
          <option value="">Sin responsable</option>
          {team.data?.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
        </select>
      </label>
      <label className={labelClass}>
        Cierre estimado
        <input name="expectedCloseDate" type="date" defaultValue={deal.expectedCloseDate ?? ''} className={inputClass} />
      </label>
      <label className={labelClass}>
        Interés
        <select name="probability" defaultValue={deal.probability === null ? '' : String(deal.probability <= 25 ? 25 : deal.probability >= 75 ? 75 : 50)} className={inputClass}>
          {INTEREST.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className={`${labelClass} sm:col-span-2`}>
        Origen
        <input name="source" maxLength={60} defaultValue={deal.source ?? ''} placeholder="WhatsApp, referido, feria…" className={inputClass} />
      </label>
      <label className={`${labelClass} sm:col-span-2`}>
        Descripción
        <textarea name="description" rows={4} maxLength={5000} defaultValue={deal.description ?? ''} placeholder="Qué necesita el cliente, acuerdos, condiciones…" className={textareaClass} />
      </label>
      {deal.contact && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-canvas px-3 py-2.5 sm:col-span-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Cliente</p>
            <p className="truncate text-sm font-medium text-ink">{deal.contact.name}</p>
            {deal.contact.phone && <p className="text-xs text-muted">{deal.contact.phone}</p>}
          </div>
          <Link to="/contacts" search={{ open: deal.contact.id } as never} className="text-xs font-medium text-ink underline">Ver cliente</Link>
        </div>
      )}
      {save.isError && <div className="sm:col-span-2"><Alert>{errorText(save.error, 'No pudimos guardar.')}</Alert></div>}
      <div className="flex items-center justify-end gap-3 sm:col-span-2">
        {saved && <span className="text-xs text-success">Guardado</span>}
        <button type="submit" disabled={save.isPending} className={primaryButton}>{save.isPending ? 'Guardando…' : 'Guardar cambios'}</button>
      </div>
    </form>
  );
}

function TasksTab({ deal }: { deal: DealDetail }) {
  const queryClient = useQueryClient();
  const { date, time } = useRegion();
  const key = ['deal-tasks', deal.id];
  const tasks = useQuery({ queryKey: key, queryFn: () => api<DealTask[]>(`/api/v1/tasks?dealId=${deal.id}&status=all`) });
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: key }), queryClient.invalidateQueries({ queryKey: ['tasks'] })]);
  const toggle = useMutation({
    mutationFn: (task: DealTask) => api(`/api/v1/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: task.status === 'open' ? 'done' : 'open' }) }),
    onSuccess: refresh,
  });
  const create = useMutation({
    mutationFn: (body: object) => api('/api/v1/tasks', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: refresh,
  });
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const hours = Number(form.get('due'));
    create.mutate({
      title: String(form.get('title')).trim(),
      dealId: deal.id,
      ...(deal.ownerId ? { assigneeId: deal.ownerId } : {}),
      ...(hours ? { dueAt: new Date(Date.now() + hours * 3_600_000).toISOString(), remindBeforeMinutes: 15 } : {}),
    }, { onSuccess: () => formEl.reset() });
  }
  const open = tasks.data?.filter((t) => t.status === 'open') ?? [];
  const done = tasks.data?.filter((t) => t.status === 'done') ?? [];
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="flex flex-wrap gap-2">
        <input name="title" required maxLength={200} placeholder="Próximo paso: llamar, enviar cotización…" aria-label="Nueva tarea" className={`${inputClass} min-w-0 flex-1`} />
        <select name="due" defaultValue="24" aria-label="Vence" className={inputClass}>
          <option value="1">En una hora</option>
          <option value="24">Mañana</option>
          <option value="72">En 3 días</option>
          <option value="168">En una semana</option>
          <option value="0">Sin fecha</option>
        </select>
        <button type="submit" disabled={create.isPending} className={primaryButton}><PlusIcon size={14} /> Agregar</button>
      </form>
      {create.isError && <Alert>{errorText(create.error, 'No pudimos crear la tarea.')}</Alert>}
      {tasks.isPending && <p className="text-xs text-muted">Cargando tareas…</p>}
      {tasks.data && !tasks.data.length && <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-muted">Sin tareas. Un negocio sin próximo paso se enfría: agrega uno arriba.</p>}
      {[['Pendientes', open], ['Hechas', done]].map(([label, list]) => (list as DealTask[]).length > 0 && (
        <section key={label as string}>
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">{label as string}</h3>
          <ul className="flex flex-col gap-1.5">
            {(list as DealTask[]).map((task) => {
              const late = task.status === 'open' && task.dueAt && Date.parse(task.dueAt) < Date.now();
              return (
                <li key={task.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
                  <input type="checkbox" checked={task.status === 'done'} onChange={() => toggle.mutate(task)} aria-label={`Marcar "${task.title}" como ${task.status === 'open' ? 'hecha' : 'pendiente'}`} className="size-4 accent-honey" />
                  <span className={`min-w-0 flex-1 truncate text-sm ${task.status === 'done' ? 'text-muted line-through' : 'text-ink'}`}>{task.title}</span>
                  {task.dueAt && <span className={`shrink-0 text-xs ${late ? 'font-semibold text-danger' : 'text-muted'}`}>{date(task.dueAt)} {time(task.dueAt)}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function MeetingsTab({ deal, myId }: { deal: DealDetail; myId: string | undefined }) {
  const queryClient = useQueryClient();
  const { date, time } = useRegion();
  const key = ['deal-meetings', deal.id];
  const meetings = useQuery({ queryKey: key, queryFn: () => api<DealMeeting[]>(`/api/v1/meetings?scope=all&dealId=${deal.id}`) });
  const start = useMutation({
    mutationFn: () => api<DealMeeting>('/api/v1/meetings', {
      method: 'POST',
      body: JSON.stringify({ title: `Reunión: ${deal.title}`, dealId: deal.id, participantIds: deal.ownerId && deal.ownerId !== myId ? [deal.ownerId] : [] }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const now = Date.now();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => start.mutate()} disabled={start.isPending} className={primaryButton}><VideoIcon size={15} /> {start.isPending ? 'Creando la sala…' : 'Reunión ahora'}</button>
        <Link to="/meetings" className={secondaryButton}><CalendarIcon size={15} /> Programar en Reuniones</Link>
      </div>
      {start.isError && <Alert>{errorText(start.error, 'No pudimos crear la reunión.')}</Alert>}
      {meetings.data && !meetings.data.length && <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-muted">Todavía no hay reuniones de este negocio.</p>}
      <ul className="flex flex-col gap-1.5">
        {meetings.data?.map((m) => {
          const upcoming = Date.parse(m.endsAt) > now;
          return (
            <li key={m.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
              <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${upcoming ? 'bg-honey-soft text-ink' : 'bg-raised text-muted'}`}><VideoIcon size={16} /></span>
              <Link to="/meetings" search={{ m: m.id }} className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{m.title}</span>
                <span className="block text-xs text-muted">{date(m.startsAt)} · {time(m.startsAt)}</span>
              </Link>
              {upcoming && <a href={m.joinUrl} target="_blank" rel="noopener noreferrer" className={`${primaryButton} min-h-8 px-3`}>Entrar</a>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HistoryTab({ deal, stages }: { deal: DealDetail; stages: Stage[] }) {
  const { date, time } = useRegion();
  const team = useTeamPresence();
  const events = useQuery({ queryKey: ['deal-events', deal.id], queryFn: () => api<DealEvent[]>(`/api/v1/deals/${deal.id}/events`) });
  const stageName = (id: unknown) => stages.find((s) => s.id === id)?.name ?? 'otra etapa';
  const who = (id: string | null) => (id ? team.data?.find((p) => p.userId === id)?.name ?? 'Alguien del equipo' : 'Automático');
  if (events.isPending) return <p className="text-xs text-muted">Cargando historial…</p>;
  if (events.isError) return <Alert>No pudimos cargar el historial.</Alert>;
  return (
    <ol className="relative ml-2 border-l border-line pl-5">
      {[...events.data].reverse().map((event, index) => (
        <li key={index} className="relative pb-4 last:pb-0">
          <span aria-hidden className="absolute -left-[1.6rem] top-1 size-2.5 rounded-full border-2 border-surface bg-honey" />
          <p className="text-sm text-ink">{describeEvent(event, stageName)}</p>
          <p className="text-xs text-muted">{who(event.actorId)} · {date(event.createdAt)} {time(event.createdAt)}</p>
        </li>
      ))}
    </ol>
  );
}

interface Insight { summary: string; temperature: 'frio' | 'tibio' | 'caliente'; nextStep: string; reply: string; savedAsNote: boolean }
const TEMPERATURE: Record<Insight['temperature'], [string, BadgeTone]> = { frio: ['Frío', 'info'], tibio: ['Tibio', 'honey'], caliente: ['Caliente', 'danger'] };

/** E05-S10 — Resumen del cliente, qué responder y próximo paso, como los botones de la referencia. */
function InsightsTab({ deal }: { deal: DealDetail }) {
  const [copied, setCopied] = useState(false);
  const generate = useMutation({ mutationFn: () => api<Insight>(`/api/v1/deals/${deal.id}/insights`, { method: 'POST' }) });
  const error = generate.error instanceof ApiError ? generate.error : undefined;
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copia la respuesta', text);
    }
  }
  return (
    <div className="flex flex-col gap-4 text-sm">
      {!generate.data && (
        <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center">
          <span className="mx-auto grid size-10 place-items-center rounded-xl bg-honey-soft text-ink"><SparklesIcon size={18} /></span>
          <p className="mt-2 text-sm font-semibold text-ink">Resumen del cliente con IA</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted">Lee la conversación y el negocio, y te dice qué necesita el cliente, qué tan caliente está, qué responder y cuál es el próximo paso.</p>
          <button type="button" onClick={() => generate.mutate()} disabled={generate.isPending} className={`${primaryButton} mt-3`}>{generate.isPending ? 'Leyendo la conversación…' : 'Generar resumen'}</button>
        </div>
      )}
      {generate.isError && (
        <Alert>
          {error?.message ?? 'No pudimos generar el resumen.'}
          {error?.code === 'AI_NOT_CONFIGURED' && <> <Link to="/settings" search={{ tab: 'ia' }} className="underline">Ir a Asistente IA</Link></>}
        </Alert>
      )}
      {generate.data && (
        <>
          <section>
            <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Resumen del cliente <Badge tone={TEMPERATURE[generate.data.temperature][1]}>{TEMPERATURE[generate.data.temperature][0]}</Badge>
            </h3>
            <p className="mt-1 text-ink">{generate.data.summary}</p>
          </section>
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">Próximo paso</h3>
            <p className="mt-1 text-ink">{generate.data.nextStep}</p>
          </section>
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">Qué responder</h3>
            <p className="mt-1 rounded-xl bg-canvas px-3 py-2 text-ink">{generate.data.reply}</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => copy(generate.data!.reply)} className={secondaryButton}>{copied ? 'Copiado' : 'Copiar respuesta'}</button>
              <button type="button" onClick={() => generate.mutate()} disabled={generate.isPending} className={secondaryButton}>Generar de nuevo</button>
            </div>
          </section>
          <p className="text-[11px] text-muted">
            {generate.data.savedAsNote ? 'Quedó como nota interna en la conversación del cliente.' : 'Este negocio no tiene conversación: el resumen no se guardó.'} Revísalo antes de usarlo: la IA puede equivocarse.
          </p>
        </>
      )}
    </div>
  );
}
