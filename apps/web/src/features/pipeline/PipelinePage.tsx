import {
  DndContext, type DragEndEvent, KeyboardSensor, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { type FormEvent, type SyntheticEvent, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { authClient } from '../../shared/auth-client';
import { useRegion } from '../../shared/i18n/use-region';
import { useRealtime } from '../../shared/realtime';
import { AppShell } from '../../shared/ui/app-shell';
import { Alert, Button } from '../../shared/ui/form';
import { ClockIcon, SparklesIcon, UsersIcon } from '../../shared/ui/icons';
import { useDebouncedValue } from '../../shared/use-debounced-value';
import { applyRemoteDeal, type Board, type BoardDeal, moveDeal, type RemoteDeal } from './board-state';
import { DealDrawer, type DrawerTab } from './DealDrawer';
import { daysInStage } from './deal-format';
import { RobotsPanel } from './RobotsPanel';

interface Stage { id: string; name: string; color: string }
interface Pipeline { id: string; name: string; stages: Stage[] }
type Card = BoardDeal & { source: string | null; createdAt: string; stageEnteredAt: string; ownerId: string | null; contact: { name: string; phone: string | null } | null; owner: { name: string } | null; stage?: { name: string } };
type CardBoard = { stages: (Omit<Board['stages'][number], 'deals'> & { deals: Card[] })[] };
interface DealContact { id: string; name: string; phone: string | null; email?: string | null }
interface DealMember { userId: string; name: string }

/** E03-S02 + X-07 — Embudo: Kanban/Lista, búsqueda, "mis leads", columnas editables. */
export function PipelinePage() {
  const pipelines = useQuery({ queryKey: ['pipelines'], queryFn: () => api<Pipeline[]>('/api/v1/pipelines') });
  const [selected, setSelected] = useState<string>();
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  // E03-S08 — El aviso "nuevo lead en el pool" enlaza a /deals?pool=1. ?deal=<id> abre la ficha del negocio.
  const search = useSearch({ from: '/deals' });
  const navigate = useNavigate();
  const [pool, setPool] = useState(search.pool === '1');
  const openDeal = (deal: string | undefined, tab?: DrawerTab) => navigate({ to: '/deals', search: (prev) => ({ ...prev, deal, tab }) });
  const [configuring, setConfiguring] = useState(false);
  const query = useDebouncedValue(q.trim());
  const pipeline = pipelines.data?.find((p) => p.id === selected) ?? pipelines.data?.[0];
  const settings = useQuery({ queryKey: ['tenant-settings'], queryFn: () => api<{ leadPool: boolean }>('/api/v1/tenant/settings'), staleTime: 5 * 60_000 });
  const poolOn = Boolean(settings.data?.leadPool);
  const filters = { q: query, mine, pool: poolOn && pool };

  return (
    <AppShell title="Negocios" subtitle="Arrastra las tarjetas para cambiar de etapa (en el celular, mantén presionada la tarjeta)." wide>
      {pipelines.isPending && <p className="text-muted">Cargando embudos…</p>}
      {pipelines.isError && <Alert>No pudimos cargar los embudos. Recarga la página.</Alert>}
      {pipeline && (
        <>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2 shadow-sm">
            {pipelines.data!.length > 1 && (
                <select aria-label="Embudo" value={pipeline.id} onChange={(e) => setSelected(e.target.value)} className="h-9 rounded-lg border border-line bg-surface px-2 text-xs font-medium">
                {pipelines.data!.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <div role="tablist" aria-label="Vista" className="flex gap-1 rounded-lg bg-canvas p-1">
              {(['kanban', 'list'] as const).map((v) => (
                <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`min-h-9 rounded-md px-3 text-xs ${view === v ? 'bg-honey font-semibold text-on-honey shadow-sm' : 'text-muted'}`}>
                  {v === 'kanban' ? 'Kanban' : 'Lista'}
                </button>
              ))}
            </div>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, teléfono o descripción" aria-label="Buscar negocios" className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 text-xs sm:max-w-none" />
            <label className="flex min-h-9 items-center gap-2 rounded-lg border border-line px-3 text-xs text-ink">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="size-4 accent-honey" /> Mis leads
            </label>
            {poolOn && (
              <label title="Leads sin dueño: el primero que los toma se queda con ellos" className="flex min-h-9 items-center gap-2 rounded-lg border border-line px-3 text-xs text-ink">
                <input type="checkbox" checked={pool} onChange={(e) => setPool(e.target.checked)} className="size-4 accent-honey" /> Pool sin dueño
              </label>
            )}
            <button onClick={() => setConfiguring((c) => !c)} aria-expanded={configuring} className="min-h-9 rounded-lg border border-line px-3 text-xs text-ink">Configurar embudo</button>
          </div>
          {configuring && <StageSettings pipeline={pipeline} />}
          {view === 'kanban' ? <KanbanBoard pipelineId={pipeline.id} filters={filters} poolOn={poolOn} onOpen={openDeal} /> : <DealList pipelineId={pipeline.id} filters={filters} onOpen={openDeal} />}
        </>
      )}
      {search.deal && (
        <DealDrawer
          dealId={search.deal}
          tab={(search.tab as DrawerTab | undefined) ?? 'resumen'}
          poolOn={poolOn}
          onTab={(tab) => void openDeal(search.deal, tab)}
          onClose={() => void openDeal(undefined)}
        />
      )}
    </AppShell>
  );
}

interface Filters { q: string; mine: boolean; pool: boolean }

const filterParams = ({ q, mine, pool }: Filters) => ({ ...(q.length >= 2 ? { q } : {}), ...(mine ? { mine: 'true' } : {}), ...(pool ? { pool: 'true' } : {}) });

/** Botones dentro de una tarjeta arrastrable: el clic no debe empezar a arrastrarla. */
const keepFromDrag = {
  onMouseDown: (e: SyntheticEvent) => e.stopPropagation(),
  onTouchStart: (e: SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: SyntheticEvent) => e.stopPropagation(),
};

function KanbanBoard({ pipelineId, filters, poolOn, onOpen }: { pipelineId: string; filters: Filters; poolOn: boolean; onOpen: (dealId: string, tab?: DrawerTab) => void }) {
  const queryClient = useQueryClient();
  const myId = authClient.useSession().data?.user.id;
  const key = ['board', pipelineId, filters.q, filters.mine, filters.pool];
  const board = useQuery({ queryKey: key, queryFn: () => api<CardBoard>(`/api/v1/pipelines/${pipelineId}/board?${new URLSearchParams(filterParams(filters))}`) });
  const [error, setError] = useState<string>();
  // E03-S08 — Tomar un lead del pool. Si otro lo tomó antes, la API lo dice y el tablero se recarga.
  const claim = useMutation({
    mutationFn: (dealId: string) => api(`/api/v1/deals/${dealId}/claim`, { method: 'POST' }),
    onMutate: () => setError(undefined),
    onError: (e) => setError(e instanceof ApiError && e.status !== 404 ? e.message : 'Otro vendedor ya tomó este lead.'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['board', pipelineId] }),
  });
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  useRealtime(['deal.moved', 'deal.closed', 'deal.created', 'deal.updated', 'deal.deleted'], (event) => {
    if (event.pipelineId && event.pipelineId !== pipelineId) return;
    const current = queryClient.getQueryData<CardBoard>(key);
    const next = current && event.dealId && event.stageId ? applyRemoteDeal(current, event as unknown as RemoteDeal) : undefined;
    if (next && next !== current) queryClient.setQueryData(key, next);
    else void queryClient.invalidateQueries({ queryKey: ['board', pipelineId] });
  });

  async function onDragEnd({ active, over }: DragEndEvent) {
    const current = board.data;
    if (!over || !current) return;
    const dealId = String(active.id);
    const overId = String(over.id);
    const column = current.stages.find((s) => s.id === overId) ?? current.stages.find((s) => s.deals.some((d) => d.id === overId))!;
    const others = column.deals.filter((d) => d.id !== dealId);
    // Soltar sobre una tarjeta = quedar después de ella; sobre la columna = al final.
    const afterDealId = column.id === overId ? (others.at(-1)?.id ?? null) : overId === dealId ? null : overId;
    queryClient.setQueryData(key, moveDeal(current, dealId, column.id, afterDealId));
    setError(undefined);
    try {
      await api(`/api/v1/deals/${dealId}/move`, { method: 'POST', body: JSON.stringify({ stageId: column.id, afterDealId }) });
    } catch {
      setError('No pudimos mover el negocio. Recargamos el tablero.');
      void queryClient.invalidateQueries({ queryKey: key });
    }
  }

  if (board.isPending) return <p className="text-muted">Cargando tablero…</p>;
  if (!board.data) return <Alert>No pudimos cargar el tablero.</Alert>;
  return (
    <>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-4">
          {board.data.stages.map((stage) => (
            <Column
              key={stage.id}
              stage={stage}
              pipelineId={pipelineId}
              onCreated={() => queryClient.invalidateQueries({ queryKey: ['board', pipelineId] })}
              card={{ myId, poolOn, onClaim: (id) => claim.mutate(id), claiming: claim.isPending ? claim.variables : undefined, onOpen }}
            />
          ))}
        </div>
      </DndContext>
    </>
  );
}

interface CardActions {
  myId: string | undefined;
  poolOn: boolean;
  onClaim: (dealId: string) => void;
  claiming: string | undefined;
  onOpen: (dealId: string, tab?: DrawerTab) => void;
}

function Column({ stage, pipelineId, onCreated, card }: { stage: CardBoard['stages'][number]; pipelineId: string; onCreated: () => void; card: CardActions }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const { money } = useRegion();
  const [adding, setAdding] = useState(false);
  const total = stage.deals.reduce((sum, d) => sum + d.value, 0);
  return (
    <section ref={setNodeRef} aria-label={`Etapa ${stage.name}`} className={`flex w-[min(15.75rem,calc(100vw-2rem))] shrink-0 snap-start flex-col rounded-lg border bg-raised p-2 ${isOver ? 'border-honey' : 'border-line'}`}>
      <header className="flex items-center gap-2 px-1 pb-2">
        <span className="size-2 rounded-full" style={{ background: stage.color }} />
        <h2 className="flex-1 truncate text-xs font-semibold text-ink">{stage.name}</h2>
        <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] text-muted">{stage.deals.length}</span>
      </header>
      {stage.deals[0] && <p className="px-1 pb-2 text-[11px] text-muted">{money(total, stage.deals[0].currency)}</p>}
      <button onClick={() => setAdding(true)} className="mb-2 min-h-7 rounded-md border border-dashed border-honey/50 bg-surface text-xs font-medium text-ink hover:bg-honey-soft">+ Nuevo negocio</button>
      <ul className="flex min-h-[32rem] flex-col gap-2">
        {stage.deals.map((deal) => <DealCard key={deal.id} deal={deal} actions={card} />)}
        {stage.deals.length === 0 && !adding && <li className="mt-3 rounded-lg border border-dashed border-line bg-surface/60 px-2 py-8 text-center text-xs text-muted"><span className="mx-auto mb-2 grid size-7 place-items-center rounded-full bg-honey-soft text-ink">+</span><strong className="block font-semibold text-ink">Sin negocios</strong><span className="mt-1 block">Arrastra aquí para crear uno nuevo.</span></li>}
      </ul>
      {adding && <QuickDeal pipelineId={pipelineId} stageId={stage.id} stageName={stage.name} onDone={() => { setAdding(false); onCreated(); }} onCancel={() => setAdding(false)} />}
    </section>
  );
}

/**
 * Tarjeta como en la referencia: cliente, teléfono, origen, responsable y fecha. El borde dice de quién es:
 * miel = tuyo, azul punteado = en el pool, sin color = de otra persona (E03-S08). Un clic abre la ficha.
 */
function DealCard({ deal, actions }: { deal: Card; actions: CardActions }) {
  const { attributes, listeners, setNodeRef: dragRef, transform, isDragging } = useDraggable({ id: deal.id });
  const { setNodeRef: dropRef } = useDroppable({ id: deal.id });
  const { money, date } = useRegion();
  const inPool = !deal.ownerId;
  const ownership = deal.ownerId && deal.ownerId === actions.myId ? 'border-l-honey' : inPool && actions.poolOn ? 'border-l-info border-dashed' : 'border-l-line';
  const stalled = daysInStage(deal.stageEnteredAt);
  return (
    <li
      ref={(node) => { dragRef(node); dropRef(node); }}
      {...attributes}
      {...listeners}
      onClick={() => actions.onOpen(deal.id)}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={`cursor-pointer touch-manipulation select-none rounded-lg border border-line border-l-2 ${ownership} bg-surface p-2.5 shadow-sm outline-none transition hover:border-honey/60 hover:shadow focus-visible:ring-2 focus-visible:ring-honey ${isDragging ? 'relative z-10 cursor-grabbing opacity-80 shadow-lg' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <button type="button" {...keepFromDrag} onClick={(e) => { e.stopPropagation(); actions.onOpen(deal.id); }} className="min-w-0 truncate text-left text-xs font-semibold text-ink hover:underline">{deal.title}</button>
        <span className="shrink-0 text-[10px] text-muted">{date(deal.createdAt)}</span>
      </div>
      {deal.contact && <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-muted"><UsersIcon size={12} /> <span className="truncate">{deal.contact.name}{deal.contact.phone ? ` · ${deal.contact.phone}` : ''}</span></p>}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{money(deal.value, deal.currency)}</p>
        {stalled >= 3 && <span title="Días en esta etapa" className="inline-flex items-center gap-0.5 rounded bg-honey-soft px-1.5 py-0.5 text-[10px] text-ink"><ClockIcon size={11} /> {stalled} d</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted">
        {deal.source && <span className="rounded bg-canvas px-1.5 py-0.5">{deal.source}</span>}
        <span className="truncate">{deal.owner?.name ?? (actions.poolOn ? 'En el pool' : 'Sin responsable')}</span>
        <span className="ml-auto flex gap-1">
          {actions.poolOn && inPool && (
            <button type="button" {...keepFromDrag} onClick={(e) => { e.stopPropagation(); actions.onClaim(deal.id); }} disabled={actions.claiming === deal.id}
              className="rounded-md bg-honey px-2 py-0.5 text-[10px] font-semibold text-on-honey disabled:opacity-60">
              {actions.claiming === deal.id ? 'Tomando…' : 'Tomar'}
            </button>
          )}
          <button type="button" {...keepFromDrag} onClick={(e) => { e.stopPropagation(); actions.onOpen(deal.id, 'ia'); }} aria-label={`Resumen IA de ${deal.title}`} title="Resumen del cliente, qué responder y próximo paso"
            className="inline-flex items-center gap-0.5 rounded-md border border-line px-1.5 py-0.5 text-[10px] text-ink hover:bg-honey-soft">
            <SparklesIcon size={11} /> IA
          </button>
        </span>
      </div>
    </li>
  );
}

function QuickDeal({ pipelineId, stageId, stageName, onDone, onCancel }: { pipelineId: string; stageId: string; stageName: string; onDone: () => void; onCancel: () => void }) {
  const { region } = useRegion();
  const create = useMutation({ mutationFn: (body: object) => api('/api/v1/deals', { method: 'POST', body: JSON.stringify(body) }), onSuccess: onDone });
  const [contactQuery, setContactQuery] = useState('');
  const [contact, setContact] = useState<DealContact>();
  const debouncedContactQuery = useDebouncedValue(contactQuery.trim());
  const contacts = useQuery({ queryKey: ['deal-contact-options', debouncedContactQuery], queryFn: () => api<{ contacts: DealContact[] }>(`/api/v1/search?q=${encodeURIComponent(debouncedContactQuery)}`), enabled: debouncedContactQuery.length >= 2 && !contact });
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<DealMember[]>('/api/v1/members'), staleTime: 60_000 });
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '').trim() || null;
    create.mutate({
      pipelineId,
      stageId,
      title: String(form.get('title')),
      value: Number(form.get('value') || 0),
      currency: text('currency') ?? region.currency,
      source: text('source'),
      probability: Number(form.get('interest') || 0),
      expectedCloseDate: text('deadline'),
      ownerId: text('ownerId') ?? undefined,
      contactId: contact?.id ?? null,
      description: text('description'),
    });
  }
  return (
    <div role="dialog" aria-modal="true" aria-label="Nuevo negocio" className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-scrim/60 p-4" onClick={onCancel}>
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[42rem] flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between border-b border-line px-6 py-5"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-lg bg-honey-soft text-xl text-ink">ϟ</span><div><h2 className="text-lg font-semibold text-ink">Nuevo negocio</h2><p className="text-xs text-muted">Etapa: {stageName}</p></div></div><button type="button" onClick={onCancel} aria-label="Cerrar" className="text-2xl leading-none text-muted hover:text-ink">×</button></div>
         <form onSubmit={onSubmit} className="min-h-0 grid gap-0 overflow-y-auto">
           <section className="grid gap-4 border-b border-line px-6 py-5 md:grid-cols-2"><label className="flex flex-col gap-1.5 text-xs font-semibold text-muted md:col-span-2">Nombre del negocio<input name="title" required placeholder="Por ejemplo, nombre del cliente o lo que necesita" aria-label="Nombre del negocio" className="h-10 rounded-lg border border-line bg-surface px-3 text-sm font-normal text-ink" /></label><div className="relative md:col-span-2"><label htmlFor="deal-contact" className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Cliente</label>{contact ? <div className="flex h-10 items-center justify-between rounded-lg border border-line px-3 text-sm text-ink"><span>{contact.name}</span><button type="button" onClick={() => setContact(undefined)} className="text-xs text-muted underline">Cambiar</button></div> : <input id="deal-contact" value={contactQuery} onChange={(event) => setContactQuery(event.target.value)} placeholder="Buscar o escribir nombre / teléfono" className="h-10 w-full rounded-lg border border-line px-3 text-sm" autoComplete="off" />}{!contact && Boolean(contacts.data?.contacts.length) && <ul role="listbox" className="absolute top-full z-10 mt-1 w-full rounded-lg border border-line bg-surface shadow-lg">{contacts.data!.contacts.map((item) => <li key={item.id}><button type="button" onClick={() => { setContact(item); setContactQuery(''); }} className="min-h-10 w-full px-3 text-left text-sm hover:bg-canvas">{item.name} <span className="text-xs text-muted">{item.phone}</span></button></li>)}</ul>}</div><label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">Teléfono<input value={contact?.phone ?? ''} readOnly placeholder="+57 300 000 0000" className="h-10 rounded-lg border border-line bg-canvas px-3 text-sm font-normal text-ink" /></label><label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">Correo<input value={contact?.email ?? ''} readOnly placeholder="cliente@ejemplo.com" className="h-10 rounded-lg border border-line bg-canvas px-3 text-sm font-normal text-ink" /></label></section>
           <section className="grid gap-4 border-b border-line px-6 py-5 md:grid-cols-2"><h3 className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-muted">ϟ Sobre el negocio</h3><label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">Monto<div className="flex"><input name="value" type="number" min={0} placeholder="0" className="h-10 min-w-0 flex-1 rounded-l-lg border border-line px-3 text-sm font-normal text-ink" /><select name="currency" defaultValue={region.currency} className="h-10 w-24 rounded-r-lg border-y border-r border-line bg-surface px-2 text-xs text-ink"><option>{region.currency}</option><option>USD</option><option>EUR</option></select></div></label><label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">Origen<select name="source" defaultValue="" className="h-10 rounded-lg border border-line bg-surface px-3 text-sm font-normal text-ink"><option value="">Manual</option><option>Referido</option><option>WhatsApp</option><option>Instagram</option></select></label><label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">Prioridad<select defaultValue="medium" className="h-10 rounded-lg border border-line bg-surface px-3 text-sm font-normal text-ink"><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option></select></label><label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">Interés<select name="interest" defaultValue="50" className="h-10 rounded-lg border border-line bg-surface px-3 text-sm font-normal text-ink"><option value="25">Frío</option><option value="50">Tibio</option><option value="75">Caliente</option></select></label><label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">Fecha límite<input name="deadline" type="date" className="h-10 rounded-lg border border-line bg-surface px-3 text-sm font-normal text-ink" /></label></section>
           <section className="grid gap-4 border-b border-line px-6 py-5 md:grid-cols-2"><h3 className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-muted">♙ Quién lo lleva</h3><label className="flex flex-col gap-1.5 text-xs font-semibold text-muted md:col-span-2">Responsable<select name="ownerId" defaultValue="" className="h-10 rounded-lg border border-line bg-surface px-3 text-sm font-normal text-ink"><option value="">Yo</option>{members.data?.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}</select></label></section>
          <section className="px-6 py-5"><label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">Descripción<textarea name="description" rows={3} placeholder="Añade una nota sobre este negocio" className="resize-none rounded-lg border border-line px-3 py-2 text-sm font-normal text-ink" /></label></section>
          {create.isError && <div className="px-6 pb-4"><Alert>No pudimos crear el negocio.</Alert></div>}
          <div className="flex shrink-0 justify-end gap-2 border-t border-line bg-surface px-6 py-4"><button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-line px-5 text-sm font-medium text-muted">Cancelar</button><Button type="submit" loading={create.isPending}>Crear negocio</Button></div>
        </form>
      </div>
    </div>
  );
}

function DealList({ pipelineId, filters, onOpen }: { pipelineId: string; filters: Filters; onOpen: (dealId: string) => void }) {
  const { money, date } = useRegion();
  const params = new URLSearchParams({ pipelineId, ...filterParams(filters) });
  const list = useQuery({ queryKey: ['deal-list', pipelineId, filters.q, filters.mine, filters.pool], queryFn: () => api<{ items: Card[] }>(`/api/v1/deals?${params}`) });
  if (list.isPending) return <p className="text-muted">Cargando…</p>;
  if (list.isError) return <Alert>No pudimos cargar los negocios.</Alert>;
  if (!list.data.items.length) return <p className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-muted">No hay negocios con estos filtros.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="border-b border-line text-muted">
          <tr>{['Negocio', 'Cliente', 'Etapa', 'Valor', 'Responsable', 'Creado'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {list.data.items.map((d) => (
            <tr key={d.id} onClick={() => onOpen(d.id)} className="cursor-pointer transition hover:bg-canvas">
              <td className="px-3 py-2 font-medium text-ink"><button type="button" onClick={(e) => { e.stopPropagation(); onOpen(d.id); }} className="text-left hover:underline">{d.title}</button></td>
              <td className="px-3 py-2 text-ink">{d.contact?.name ?? 'Sin cliente'}</td>
              <td className="px-3 py-2 text-ink">{d.stage?.name}</td>
              <td className="px-3 py-2 text-ink">{money(d.value, d.currency)}</td>
              <td className="px-3 py-2 text-muted">{d.owner?.name ?? 'Sin responsable'}</td>
              <td className="px-3 py-2 text-muted">{date(d.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** E03-S01 en la UI ("Funnel settings" de la referencia): crear, renombrar, colorear y borrar columnas. */
function StageSettings({ pipeline }: { pipeline: Pipeline }) {
  const queryClient = useQueryClient();
  const call = useMutation({
    mutationFn: ({ url, method, body }: { url: string; method: string; body?: object }) => api(url, { method, body: body && JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      void queryClient.invalidateQueries({ queryKey: ['board', pipeline.id] });
    },
  });

  function addStage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    call.mutate({ url: `/api/v1/pipelines/${pipeline.id}/stages`, method: 'POST', body: { name: String(new FormData(formEl).get('name')) } }, { onSuccess: () => formEl.reset() });
  }

  return (
    <section aria-label="Configurar embudo" className="mb-4 rounded-xl border border-line bg-surface p-4">
      <ul className="flex flex-col gap-2">
        {pipeline.stages.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2">
            <input type="color" defaultValue={s.color} aria-label={`Color de ${s.name}`} onBlur={(e) => e.target.value !== s.color && call.mutate({ url: `/api/v1/stages/${s.id}`, method: 'PATCH', body: { color: e.target.value } })} className="h-11 w-11 rounded border border-line" />
            <input defaultValue={s.name} aria-label={`Nombre de la etapa ${s.name}`} onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && call.mutate({ url: `/api/v1/stages/${s.id}`, method: 'PATCH', body: { name: e.target.value.trim() } })} className="h-11 min-w-0 flex-1 rounded-lg border border-line px-3" />
            <button onClick={() => confirm(`¿Borrar la etapa "${s.name}"?`) && call.mutate({ url: `/api/v1/stages/${s.id}`, method: 'DELETE' })} className="min-h-11 px-2 text-sm text-danger underline">Borrar</button>
          </li>
        ))}
      </ul>
      <form onSubmit={addStage} className="mt-3 flex gap-2">
        <input name="name" required placeholder="Nueva columna" aria-label="Nombre de la nueva columna" className="h-11 min-w-0 flex-1 rounded-lg border border-line px-3" />
        <Button type="submit" loading={call.isPending}>Agregar columna</Button>
      </form>
      {call.isError && <div className="mt-3"><Alert>{call.error instanceof ApiError ? (call.error.status === 403 ? 'Solo propietarios y administradores configuran el embudo.' : call.error.message) : 'No se pudo guardar.'}</Alert></div>}
      <RobotsPanel pipelineId={pipeline.id} stages={pipeline.stages} />
    </section>
  );
}
