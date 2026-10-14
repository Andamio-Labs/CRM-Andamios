import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { authClient } from '../../shared/auth-client';
import { useRegion } from '../../shared/i18n/use-region';
import { AppShell } from '../../shared/ui/app-shell';
import { Alert } from '../../shared/ui/form';
import {
  Badge,
  dangerButton,
  EmptyState,
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
  Segmented,
  textareaClass,
} from '../../shared/ui/section';
import { useDebouncedValue } from '../../shared/use-debounced-value';
import { PresenceDot, useTeamPresence } from '../team/presence';
import { dayKey, gridRange, isLive, monthGrid, nextFullHour, parseEmails, toLocalInput } from './meeting-dates';

interface Meeting {
  id: string;
  title: string;
  agenda: string | null;
  startsAt: string;
  endsAt: string;
  joinUrl: string;
  organizerId: string | null;
  organizerName: string | null;
  participants: { userId: string; name: string | null }[];
  guestEmails: string[];
  dealId: string | null;
  dealTitle: string | null;
  minutes: string | null;
  recordingUrl: string | null;
  canManage: boolean;
}

type Tab = 'upcoming' | 'past' | 'calendar' | 'recordings' | 'minutes';
const TABS: [Tab, string][] = [['upcoming', 'Próximas'], ['past', 'Pasadas'], ['calendar', 'Calendario'], ['recordings', 'Grabaciones'], ['minutes', 'Actas']];

const errorText = (error: unknown, fallback: string) => (error instanceof ApiError && error.status < 500 ? error.message : fallback);

/** E12-S03 — Reuniones online con el equipo y con clientes: empezar ya, unirse, programar, calendario, acta y grabación. */
export function MeetingsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { m: openId } = useSearch({ from: '/meetings' });
  const [tab, setTab] = useState<Tab>('upcoming');
  const [dialog, setDialog] = useState<'join' | 'schedule'>();
  const open = (id: string | undefined) => navigate({ to: '/meetings', search: id ? { m: id } : {} });

  const startNow = useMutation({
    mutationFn: () => api<Meeting>('/api/v1/meetings', { method: 'POST', body: JSON.stringify({ title: 'Reunión rápida' }) }),
    onSuccess: (meeting) => {
      void queryClient.invalidateQueries({ queryKey: ['meetings'] });
      void open(meeting.id);
    },
  });

  return (
    <AppShell title="Reuniones" subtitle="Reuniones online con tu equipo y tus clientes: agenda, entra con un enlace y guarda el acta." wide>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ActionCard primary icon={<VideoIcon />} title="Nueva reunión" text="Empieza ya y comparte el enlace con quien quieras." onClick={() => startNow.mutate()} busy={startNow.isPending} />
        <ActionCard icon={<LinkIcon />} title="Unirse" text="Con el enlace de una reunión." onClick={() => setDialog('join')} />
        <ActionCard icon={<CalendarPlusIcon />} title="Programar" text="Con invitación a tu equipo y a invitados de afuera." onClick={() => setDialog('schedule')} />
        <ActionCard icon={<CalendarIcon />} title="Calendario" text="Todas tus reuniones, día por día." onClick={() => setTab('calendar')} />
      </div>
      {startNow.isError && <div className="mt-3"><Alert>{errorText(startNow.error, 'No pudimos crear la reunión. Inténtalo de nuevo.')}</Alert></div>}

      <div className="mt-5">
        <Segmented label="Reuniones" options={TABS} value={tab} onChange={setTab} />
      </div>
      <div className="mt-3">
        {tab === 'calendar'
          ? <CalendarView onOpen={open} />
          : <MeetingList scope={tab} onOpen={open} onStart={() => startNow.mutate()} onSchedule={() => setDialog('schedule')} />}
      </div>

      {dialog === 'join' && <JoinDialog onClose={() => setDialog(undefined)} />}
      {dialog === 'schedule' && (
        <ScheduleDialog
          onClose={() => setDialog(undefined)}
          onCreated={(meeting) => {
            setDialog(undefined);
            void queryClient.invalidateQueries({ queryKey: ['meetings'] });
            void open(meeting.id);
          }}
        />
      )}
      {openId && <MeetingDialog id={openId} onClose={() => open(undefined)} />}
    </AppShell>
  );
}

const EMPTY: Record<Exclude<Tab, 'calendar'>, { title: string; text: string }> = {
  upcoming: { title: 'No tienes reuniones próximas', text: 'Empieza una ahora o prográmala: tu equipo recibe una invitación y los invitados de afuera, el enlace por correo.' },
  past: { title: 'Todavía no hay reuniones pasadas', text: 'Aquí quedan las reuniones que ya terminaron, con su acta y su grabación.' },
  recordings: { title: 'Sin grabaciones', text: 'Abre una reunión y pega el enlace de su grabación (Drive, YouTube o la de tu sala de video).' },
  minutes: { title: 'Sin actas', text: 'Abre una reunión y anota lo que se acordó: queda aquí para todos los que participaron.' },
};

function MeetingList({ scope, onOpen, onStart, onSchedule }: {
  scope: Exclude<Tab, 'calendar'>;
  onOpen: (id: string) => void;
  onStart: () => void;
  onSchedule: () => void;
}) {
  const meetings = useQuery({ queryKey: ['meetings', scope], queryFn: () => api<Meeting[]>(`/api/v1/meetings?scope=${scope}`), refetchInterval: 60_000 });

  if (meetings.isPending) return <p className="text-xs text-muted">Cargando reuniones…</p>;
  if (meetings.isError) return <Alert>No pudimos cargar las reuniones. Recarga la página.</Alert>;
  if (!meetings.data.length) {
    return (
      <EmptyState
        icon={<CalendarPlusIcon />}
        title={EMPTY[scope].title}
        action={scope === 'upcoming' && (
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" onClick={onStart} className={primaryButton}><VideoIcon /> Nueva reunión</button>
            <button type="button" onClick={onSchedule} className={secondaryButton}><CalendarPlusIcon /> Programar</button>
          </div>
        )}
      >
        {EMPTY[scope].text}
      </EmptyState>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {meetings.data.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} onOpen={onOpen} showJoin={scope === 'upcoming'} />)}
    </ul>
  );
}

function MeetingRow({ meeting, onOpen, showJoin }: { meeting: Meeting; onOpen: (id: string) => void; showJoin: boolean }) {
  const { time, region } = useRegion();
  const start = new Date(meeting.startsAt);
  const day = new Intl.DateTimeFormat(region.locale, { timeZone: region.timeZone, day: 'numeric' }).format(start);
  const month = new Intl.DateTimeFormat(region.locale, { timeZone: region.timeZone, month: 'short' }).format(start).replace('.', '');
  const people = meeting.participants.length + meeting.guestEmails.length;
  return (
    <li className="flex items-center gap-2 rounded-xl border border-line bg-surface p-2 pr-3 shadow-sm transition hover:border-honey/60">
      <button type="button" onClick={() => onOpen(meeting.id)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left">
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-honey-soft text-center leading-none text-ink">
          <span><span className="block text-base font-semibold">{day}</span><span className="block text-[10px] uppercase">{month}</span></span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-ink">{meeting.title}</span>
            {isLive(meeting) && <Badge tone="success">En curso</Badge>}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted">
            {time(meeting.startsAt)} – {time(meeting.endsAt)}
            {meeting.organizerName && ` · Organiza ${meeting.organizerName}`}
            {people > 0 && ` · ${people} ${people === 1 ? 'invitado' : 'invitados'}`}
            {meeting.dealTitle && ` · ${meeting.dealTitle}`}
          </span>
        </span>
        {meeting.minutes && <Badge>Acta</Badge>}
        {meeting.recordingUrl && <Badge tone="info">Grabación</Badge>}
      </button>
      {showJoin && <a href={meeting.joinUrl} target="_blank" rel="noopener noreferrer" className={primaryButton}>Entrar</a>}
    </li>
  );
}

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function CalendarView({ onOpen }: { onOpen: (id: string) => void }) {
  const { region, time } = useRegion();
  const today = dayKey(new Date(), region.timeZone);
  const [cursor, setCursor] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 }));
  const { from, to } = gridRange(cursor.year, cursor.month);
  const meetings = useQuery({
    queryKey: ['meetings', 'range', from, to],
    queryFn: () => api<Meeting[]>(`/api/v1/meetings?scope=range&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  });
  const byDay = new Map<string, Meeting[]>();
  for (const meeting of meetings.data ?? []) {
    const key = dayKey(meeting.startsAt, region.timeZone);
    byDay.set(key, [...(byDay.get(key) ?? []), meeting]);
  }
  const label = new Intl.DateTimeFormat(region.locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(cursor.year, cursor.month, 1)));
  const move = (delta: number) => setCursor(({ year, month }) => ({ year: year + Math.floor((month + delta) / 12), month: (((month + delta) % 12) + 12) % 12 }));

  return (
    <section aria-label="Calendario de reuniones" className="rounded-xl border border-line bg-surface p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold capitalize text-ink">{label}</h2>
        <div className="flex gap-1">
          <button type="button" onClick={() => move(-1)} aria-label="Mes anterior" className={secondaryButton}>‹</button>
          <button type="button" onClick={() => setCursor({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 })} className={secondaryButton}>Hoy</button>
          <button type="button" onClick={() => move(1)} aria-label="Mes siguiente" className={secondaryButton}>›</button>
        </div>
      </div>
      {meetings.isError && <Alert>No pudimos cargar el calendario.</Alert>}
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line text-xs">
        {WEEKDAYS.map((d) => <div key={d} className="bg-raised px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">{d}</div>)}
        {monthGrid(cursor.year, cursor.month).map((cell) => {
          const items = byDay.get(cell.key) ?? [];
          return (
            <div key={cell.key} className={`min-h-16 bg-surface p-1 sm:min-h-24 ${cell.inMonth ? '' : 'opacity-50'}`}>
              <span className={`inline-grid size-6 place-items-center rounded-full text-[11px] ${cell.key === today ? 'bg-honey font-semibold text-ink' : 'text-muted'}`}>{cell.day}</span>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {items.slice(0, 3).map((meeting) => (
                  <li key={meeting.id}>
                    <button type="button" onClick={() => onOpen(meeting.id)} title={meeting.title} className="flex w-full items-center gap-1 truncate rounded bg-honey-soft px-1 py-0.5 text-left text-[10px] text-ink hover:brightness-95">
                      <span className="hidden shrink-0 text-muted sm:inline">{time(meeting.startsAt)}</span>
                      <span className="truncate">{meeting.title}</span>
                    </button>
                  </li>
                ))}
                {items.length > 3 && <li className="px-1 text-[10px] text-muted">+{items.length - 3} más</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MeetingDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { date, time } = useRegion();
  const [copied, setCopied] = useState(false);
  const meeting = useQuery({ queryKey: ['meeting', id], queryFn: () => api<Meeting>(`/api/v1/meetings/${id}`), retry: false });
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['meetings'] }),
    queryClient.invalidateQueries({ queryKey: ['meeting', id] }),
  ]);
  const save = useMutation({
    mutationFn: (body: { minutes: string | null; recordingUrl: string | null }) => api<Meeting>(`/api/v1/meetings/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: () => api(`/api/v1/meetings/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['meetings'] });
      onClose();
    },
  });

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copia el enlace de la reunión', url);
    }
  }

  function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const recording = String(form.get('recordingUrl')).trim();
    save.mutate({ minutes: String(form.get('minutes')).trim() || null, recordingUrl: recording || null });
  }

  if (meeting.isPending) return <Modal title="Reunión" onClose={onClose}><p className="p-5 text-xs text-muted">Cargando…</p></Modal>;
  if (meeting.isError) {
    return (
      <Modal title="Reunión" onClose={onClose}>
        <div className="p-5"><Alert>Esta reunión no existe, se canceló o no te invitaron.</Alert></div>
      </Modal>
    );
  }

  const m = meeting.data;
  const ended = Date.parse(m.endsAt) <= Date.now();
  const live = isLive(m);
  return (
    <Modal title={m.title} subtitle={`${date(m.startsAt)} · ${time(m.startsAt)} – ${time(m.endsAt)}`} onClose={onClose}>
      <div className="flex flex-col gap-5 p-5">
        <div className="flex flex-wrap items-center gap-2">
          {live && <Badge tone="success">En curso</Badge>}
          {ended && <Badge>Terminó</Badge>}
          {!ended && <a href={m.joinUrl} target="_blank" rel="noopener noreferrer" className={primaryButton}><VideoIcon /> Entrar a la reunión</a>}
          <button type="button" onClick={() => copyLink(m.joinUrl)} className={secondaryButton}><LinkIcon /> {copied ? 'Enlace copiado' : 'Copiar enlace'}</button>
        </div>
        <p className="-mt-3 break-all text-[11px] text-muted">{m.joinUrl}</p>

        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          <Info label="Organiza">{m.organizerName ?? 'Ya no está en el equipo'}</Info>
          <Info label="Negocio">{m.dealId && m.dealTitle ? <Link to="/deals" className="underline">{m.dealTitle}</Link> : 'Sin negocio'}</Info>
          <Info label="Del equipo">{m.participants.length ? m.participants.map((p) => p.name ?? 'Ex miembro').join(', ') : 'Nadie más'}</Info>
          <Info label="Invitados de afuera">{m.guestEmails.length ? m.guestEmails.join(', ') : 'Ninguno'}</Info>
        </dl>
        {m.agenda && <div><p className={labelClass}>Temas</p><p className="mt-1 whitespace-pre-line text-xs text-ink">{m.agenda}</p></div>}

        <form key={m.id} onSubmit={onSave} className="flex flex-col gap-3 border-t border-line pt-4">
          <label className={labelClass}>
            Acta: qué se acordó
            <textarea name="minutes" defaultValue={m.minutes ?? ''} rows={4} maxLength={20_000} placeholder="Acuerdos, responsables y próximos pasos" className={textareaClass} />
          </label>
          <label className={labelClass}>
            Enlace de la grabación
            <input name="recordingUrl" type="url" defaultValue={m.recordingUrl ?? ''} placeholder="https://…" className={inputClass} />
          </label>
          {save.isError && <Alert>{errorText(save.error, 'No pudimos guardar.')}</Alert>}
          {save.isSuccess && !save.isPending && <Alert tone="success">Guardado.</Alert>}
          <div className="flex flex-wrap justify-between gap-2">
            {m.canManage ? (
              <button type="button" disabled={cancel.isPending} onClick={() => confirm(ended ? `¿Borrar "${m.title}" del historial?` : `¿Cancelar "${m.title}"? Avisaremos a los invitados.`) && cancel.mutate()} className={dangerButton}>
                {ended ? 'Borrar del historial' : 'Cancelar reunión'}
              </button>
            ) : <span />}
            <button type="submit" disabled={save.isPending} className={primaryButton}>Guardar acta y grabación</button>
          </div>
          {cancel.isError && <Alert>{errorText(cancel.error, 'No pudimos cancelar la reunión.')}</Alert>}
        </form>
      </div>
    </Modal>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}

/** "Unirse": abre el enlace de una reunión (de BeeCRM, Meet, Zoom o Teams) en otra pestaña. */
function JoinDialog({ onClose }: { onClose: () => void }) {
  const [error, setError] = useState<string>();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const link = String(new FormData(event.currentTarget).get('link')).trim();
    if (!URL.canParse(link) || new URL(link).protocol !== 'https:') return setError('Pega el enlace completo de la reunión: empieza con https://');
    window.open(link, '_blank', 'noopener,noreferrer');
    onClose();
  }
  return (
    <Modal title="Unirse a una reunión" subtitle="Pega el enlace que te compartieron." onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3 p-5" noValidate>
        <label className={labelClass}>
          Enlace de la reunión
          <input name="link" type="url" required autoFocus placeholder="https://meet.jit.si/…" className={inputClass} />
        </label>
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button type="button" onClick={onClose} className={secondaryButton}>Cancelar</button>
          <button type="submit" className={primaryButton}>Unirme</button>
        </div>
      </form>
    </Modal>
  );
}

interface DealOption { id: string; title: string; contact: { name: string } | null }

function ScheduleDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (meeting: Meeting) => void }) {
  const session = authClient.useSession();
  const team = useTeamPresence();
  const [startsAt, setStartsAt] = useState(() => toLocalInput(nextFullHour()));
  const [invited, setInvited] = useState<string[]>([]);
  const [dealQuery, setDealQuery] = useState('');
  const [deal, setDeal] = useState<DealOption>();
  const [formError, setFormError] = useState<string>();
  const q = useDebouncedValue(dealQuery.trim());
  const deals = useQuery({
    queryKey: ['deal-options', q],
    queryFn: () => api<{ items: DealOption[] }>(`/api/v1/deals?q=${encodeURIComponent(q)}&limit=8`),
    enabled: q.length >= 2 && !deal,
  });
  const create = useMutation({
    mutationFn: (body: object) => api<Meeting>('/api/v1/meetings', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: onCreated,
  });
  const colleagues = team.data?.filter((p) => p.userId !== session.data?.user.id) ?? [];

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const guests = parseEmails(String(form.get('guests')));
    if (guests.invalid.length) return setFormError(`Revisa estos correos: ${guests.invalid.join(', ')}`);
    if (!startsAt) return setFormError('Elige la fecha y la hora.');
    const joinUrl = String(form.get('joinUrl')).trim();
    setFormError(undefined);
    create.mutate({
      title: String(form.get('title')).trim(),
      startsAt: new Date(startsAt).toISOString(),
      durationMinutes: Number(form.get('duration')),
      participantIds: invited,
      guestEmails: guests.valid,
      dealId: deal?.id,
      joinUrl: joinUrl || undefined,
      agenda: String(form.get('agenda')).trim() || undefined,
    });
  }

  return (
    <Modal title="Programar reunión" subtitle="Tu equipo recibe una invitación en la campana y los invitados de afuera, el enlace por correo." onClose={onClose} wide>
      <form onSubmit={onSubmit} className="grid gap-4 p-5 sm:grid-cols-2">
        <label className={`${labelClass} sm:col-span-2`}>
          Título
          <input name="title" required maxLength={200} placeholder="Demo con el cliente" className={inputClass} />
        </label>
        <label className={labelClass}>
          Fecha y hora
          <input type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={inputClass} />
        </label>
        <label className={labelClass}>
          Duración
          <select name="duration" defaultValue="30" className={inputClass}>
            {[15, 30, 45, 60, 90, 120].map((min) => <option key={min} value={min}>{min < 60 ? `${min} minutos` : `${min / 60} ${min === 60 ? 'hora' : 'horas'}`.replace('1.5 horas', '1 hora y media')}</option>)}
          </select>
        </label>

        <fieldset className="sm:col-span-2">
          <legend className="text-xs font-semibold text-muted">Tu equipo</legend>
          {!colleagues.length && <p className="mt-1.5 text-xs text-muted">Todavía no hay más personas en tu equipo.</p>}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {colleagues.map((p) => {
              const checked = invited.includes(p.userId);
              return (
                <label key={p.userId} className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-xs ${checked ? 'border-honey bg-honey-soft text-ink' : 'border-line text-muted'}`}>
                  <input type="checkbox" checked={checked} onChange={() => setInvited((list) => (checked ? list.filter((id) => id !== p.userId) : [...list, p.userId]))} className="size-3.5 accent-honey" />
                  <PresenceDot status={p.status} className="size-2" />
                  {p.name}
                </label>
              );
            })}
          </div>
        </fieldset>

        <label className={`${labelClass} sm:col-span-2`}>
          Invitados de afuera
          <input name="guests" placeholder="cliente@empresa.co, socia@empresa.co" className={inputClass} />
        </label>

        <div className="relative flex flex-col gap-1.5">
          <label htmlFor="meeting-deal" className="text-xs font-semibold text-muted">Negocio (opcional)</label>
          {deal ? (
            <p className="flex min-h-10 items-center justify-between gap-2 rounded-lg border border-line px-3 text-sm text-ink">
              <span className="truncate">{deal.title}</span>
              <button type="button" onClick={() => setDeal(undefined)} className="text-xs text-muted underline">Quitar</button>
            </p>
          ) : (
            <input id="meeting-deal" value={dealQuery} onChange={(e) => setDealQuery(e.target.value)} placeholder="Busca por negocio o cliente" autoComplete="off" className={inputClass} />
          )}
          {!deal && Boolean(deals.data?.items.length) && (
            <ul role="listbox" className="absolute top-full z-10 mt-1 w-full rounded-lg border border-line bg-surface shadow-lg">
              {deals.data!.items.map((d) => (
                <li key={d.id}>
                  <button type="button" onClick={() => setDeal(d)} className="min-h-10 w-full px-3 text-left text-sm text-ink hover:bg-canvas">
                    {d.title} <span className="text-xs text-muted">{d.contact?.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <label className={labelClass}>
          Enlace propio (opcional)
          <input name="joinUrl" type="url" placeholder="Vacío: creamos una sala de video" className={inputClass} />
        </label>

        <label className={`${labelClass} sm:col-span-2`}>
          Temas
          <textarea name="agenda" rows={3} maxLength={5000} placeholder="Qué se va a revisar" className={textareaClass} />
        </label>

        {(formError || create.isError) && <div className="sm:col-span-2"><Alert>{formError ?? errorText(create.error, 'No pudimos programar la reunión.')}</Alert></div>}
        <div className="flex justify-end gap-2 border-t border-line pt-4 sm:col-span-2">
          <button type="button" onClick={onClose} className={secondaryButton}>Cancelar</button>
          <button type="submit" disabled={create.isPending} className={primaryButton}>{create.isPending ? 'Programando…' : 'Programar reunión'}</button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ title, subtitle, onClose, wide, children }: { title: string; subtitle?: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/60 p-4 sm:items-center" onClick={onClose}>
      <div className={`w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} overflow-hidden rounded-2xl bg-surface shadow-2xl`} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-1 text-xs text-muted">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-2xl leading-none text-muted hover:text-ink">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ActionCard({ icon, title, text, onClick, primary, busy }: { icon: ReactNode; title: string; text: string; onClick: () => void; primary?: boolean; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`flex min-h-32 flex-col items-start gap-3 rounded-2xl border p-4 text-left shadow-sm transition disabled:opacity-60 ${primary ? 'border-honey bg-honey text-ink hover:brightness-95' : 'border-line bg-surface text-ink hover:border-honey/60'}`}
    >
      <span className={`grid size-10 place-items-center rounded-xl ${primary ? 'bg-ink/10' : 'bg-honey-soft'}`}>{icon}</span>
      <span>
        <span className="block text-sm font-semibold">{busy ? 'Creando la sala…' : title}</span>
        <span className={`mt-1 block text-xs ${primary ? 'opacity-80' : 'text-muted'}`}>{text}</span>
      </span>
    </button>
  );
}

const iconProps = { 'aria-hidden': true, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', className: 'size-4' } as const;
const VideoIcon = () => <svg {...iconProps}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3z" /></svg>;
const LinkIcon = () => <svg {...iconProps}><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" /></svg>;
const CalendarPlusIcon = () => <svg {...iconProps}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M12 13v5M9.5 15.5h5" /></svg>;
const CalendarIcon = () => <svg {...iconProps}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" /></svg>;
