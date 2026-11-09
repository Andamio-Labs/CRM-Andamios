import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { type FormEvent, type KeyboardEvent, Fragment, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { authClient } from '../../shared/auth-client';
import { useRegion } from '../../shared/i18n/use-region';
import { initials } from '../../shared/initials';
import { AppShell } from '../../shared/ui/app-shell';
import { Alert } from '../../shared/ui/form';
import { ChatIcon, ChevronLeftIcon, CloseIcon, KanbanIcon, NoteIcon, PlusIcon, SendIcon, TeamIcon, TrashIcon, VideoIcon } from '../../shared/ui/icons';
import { inputClass, labelClass, primaryButton, secondaryButton } from '../../shared/ui/section';
import { useDebouncedValue } from '../../shared/use-debounced-value';
import { PresenceDot, useTeamPresence } from '../team/presence';
import { type TeamChat, type TeamMessage, useTeamChats } from './chat-api';
import { dayLabel, linkify } from './chat-format';

/** E12-S03 — Chat interno del equipo: general, notas personales, directos y grupos con negocio adjunto. */
export function TeamChatPage() {
  const navigate = useNavigate();
  const { c: chatId } = useSearch({ from: '/team-chat' });
  const chats = useTeamChats();
  const [creating, setCreating] = useState(false);
  const open = (id: string | undefined) => navigate({ to: '/team-chat', search: id ? { c: id } : {} });
  const selected = chats.data?.find((chat) => chat.id === chatId) ?? (chatId ? undefined : chats.data?.[0]);

  return (
    <AppShell title="Chat del equipo" subtitle="Conversa con tu equipo, comparte negocios y arma una reunión en un clic." wide>
      {chats.isError && <Alert>No pudimos cargar los chats. Recarga la página.</Alert>}
      <div className="grid h-[calc(100dvh-11rem)] min-h-[28rem] overflow-hidden rounded-2xl border border-line bg-surface shadow-sm md:grid-cols-[18rem_1fr]">
        <aside className={`flex min-h-0 flex-col border-line md:border-r ${selected && chatId ? 'hidden md:flex' : 'flex'}`}>
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Chats</h2>
            <button type="button" onClick={() => setCreating(true)} className={`${primaryButton} min-h-8 px-3`}><PlusIcon size={14} /> Nuevo</button>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {chats.isPending && <li className="px-3 py-4 text-xs text-muted">Cargando…</li>}
            {chats.data?.map((chat) => <ChatRow key={chat.id} chat={chat} active={chat.id === selected?.id} onOpen={() => open(chat.id)} />)}
          </ul>
        </aside>
        <section className={`min-h-0 min-w-0 flex-col ${selected && chatId ? 'flex' : 'hidden md:flex'}`}>
          {selected ? <Conversation key={selected.id} chat={selected} onBack={() => open(undefined)} /> : <NoChat loading={chats.isPending} />}
        </section>
      </div>
      {creating && <NewChatDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); void open(id); }} />}
    </AppShell>
  );
}

function ChatAvatar({ chat, myId }: { chat: TeamChat; myId: string | undefined }) {
  const presence = useTeamPresence();
  if (chat.kind === 'general') return <span className="grid size-9 shrink-0 place-items-center rounded-full bg-honey text-on-honey"><TeamIcon size={17} /></span>;
  if (chat.kind === 'notes') return <span className="grid size-9 shrink-0 place-items-center rounded-full bg-raised text-ink"><NoteIcon size={17} /></span>;
  if (chat.kind === 'group') return <span className="grid size-9 shrink-0 place-items-center rounded-full bg-honey-soft text-ink">{chat.dealId ? <KanbanIcon size={17} /> : <ChatIcon size={17} />}</span>;
  const other = chat.members.find((m) => m.userId !== myId);
  const status = presence.data?.find((p) => p.userId === other?.userId)?.status;
  return (
    <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-honey-soft text-[11px] font-bold text-ink">
      {initials(chat.title)}
      {status && <PresenceDot status={status} className="absolute -bottom-0.5 -right-0.5 size-3 ring-2 ring-surface" />}
    </span>
  );
}

function ChatRow({ chat, active, onOpen }: { chat: TeamChat; active: boolean; onOpen: () => void }) {
  const myId = authClient.useSession().data?.user.id;
  const preview = chat.lastMessage
    ? `${chat.lastMessage.authorName ? `${chat.lastMessage.authorName}: ` : ''}${chat.lastMessage.deleted ? 'Mensaje eliminado' : chat.lastMessage.body}`
    : chat.kind === 'notes' ? 'Solo tú ves lo que escribes aquí' : 'Sin mensajes todavía';
  return (
    <li>
      <button type="button" onClick={onOpen} aria-current={active} className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${active ? 'bg-honey-soft' : 'hover:bg-canvas'}`}>
        <ChatAvatar chat={chat} myId={myId} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={`truncate text-sm ${chat.unread ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>{chat.title}</span>
          </span>
          <span className="block truncate text-xs text-muted">{preview}</span>
        </span>
        {chat.unread > 0 && <span className="rounded-full bg-honey px-1.5 text-[10px] font-bold text-on-honey">{chat.unread}</span>}
      </button>
    </li>
  );
}

function NoChat({ loading }: { loading: boolean }) {
  return (
    <div className="grid flex-1 place-items-center p-6 text-center">
      {!loading && (
        <div>
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-honey-soft text-ink"><ChatIcon size={22} /></span>
          <p className="mt-3 text-sm font-semibold text-ink">Elige un chat</p>
          <p className="mt-1 text-xs text-muted">O crea uno nuevo con tu equipo.</p>
        </div>
      )}
    </div>
  );
}

function Conversation({ chat, onBack }: { chat: TeamChat; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { time, date } = useRegion();
  const myId = authClient.useSession().data?.user.id;
  const presence = useTeamPresence();
  const [older, setOlder] = useState<TeamMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(true);
  const [meetingLink, setMeetingLink] = useState<string>();
  const bottom = useRef<HTMLDivElement>(null);
  const messages = useQuery({
    queryKey: ['team-messages', chat.id],
    queryFn: () => api<TeamMessage[]>(`/api/v1/team-chats/${chat.id}/messages?limit=50`),
  });
  const all = [...older, ...(messages.data ?? [])];

  // Abrir el chat o recibir mensajes nuevos con el chat a la vista = leído.
  useEffect(() => {
    if (!messages.data) return;
    void api(`/api/v1/team-chats/${chat.id}/read`, { method: 'POST' }).then(() => queryClient.invalidateQueries({ queryKey: ['team-chats'] }));
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.data, chat.id, queryClient]);

  const loadOlder = useMutation({
    mutationFn: () => api<TeamMessage[]>(`/api/v1/team-chats/${chat.id}/messages?limit=50&before=${encodeURIComponent(all[0]!.createdAt)}`),
    onSuccess: (page) => {
      setOlder((current) => [...page, ...current]);
      setHasOlder(page.length === 50);
    },
  });
  const send = useMutation({
    mutationFn: (body: string) => api<TeamMessage>(`/api/v1/team-chats/${chat.id}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team-messages', chat.id] }),
  });
  const remove = useMutation({
    mutationFn: (messageId: string) => api(`/api/v1/team-chats/${chat.id}/messages/${messageId}`, { method: 'DELETE' }),
    onSuccess: (_, messageId) => {
      setOlder((current) => current.map((m) => (m.id === messageId ? { ...m, deleted: true, body: '', canDelete: false } : m)));
      void queryClient.invalidateQueries({ queryKey: ['team-messages', chat.id] });
    },
  });
  // Reunión con los miembros del chat: se crea la sala y el enlace queda en la conversación.
  const meet = useMutation({
    mutationFn: async () => {
      const meeting = await api<{ joinUrl: string }>('/api/v1/meetings', {
        method: 'POST',
        body: JSON.stringify({ title: `Reunión: ${chat.title}`, participantIds: chat.members.map((m) => m.userId).filter((id) => id !== myId) }),
      });
      await api(`/api/v1/team-chats/${chat.id}/messages`, { method: 'POST', body: JSON.stringify({ body: `Armé una reunión, entra aquí: ${meeting.joinUrl}` }) });
      return meeting.joinUrl;
    },
    onSuccess: (url) => {
      setMeetingLink(url);
      void queryClient.invalidateQueries({ queryKey: ['team-messages', chat.id] });
    },
  });

  const online = chat.members.filter((m) => m.userId !== myId && presence.data?.find((p) => p.userId === m.userId)?.status === 'online').length;
  const subtitle = chat.kind === 'general' ? 'Toda la empresa'
    : chat.kind === 'notes' ? 'Solo tú ves estas notas'
      : `${chat.members.length} personas${online ? ` · ${online} en línea` : ''}`;

  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <button type="button" onClick={onBack} aria-label="Volver a los chats" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-canvas md:hidden"><ChevronLeftIcon size={18} /></button>
        <ChatAvatar chat={chat} myId={myId} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-ink">{chat.title}</h2>
          <p className="truncate text-xs text-muted">
            {subtitle}
            {chat.dealId && chat.dealTitle && <> · <Link to="/deals" search={{ deal: chat.dealId }} className="underline">Negocio: {chat.dealTitle}</Link></>}
          </p>
        </div>
        {chat.kind !== 'notes' && (
          <button type="button" onClick={() => meet.mutate()} disabled={meet.isPending} className={secondaryButton} title="Crea una reunión con los miembros del chat y deja el enlace aquí">
            <VideoIcon size={15} /> {meet.isPending ? 'Creando…' : 'Reunión'}
          </button>
        )}
      </header>
      {meetingLink && (
        <div className="flex items-center justify-between gap-2 border-b border-line bg-success-soft px-4 py-2 text-xs text-ink">
          <span>Reunión creada y compartida en el chat.</span>
          <span className="flex items-center gap-2">
            <a href={meetingLink} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Entrar ahora</a>
            <button type="button" onClick={() => setMeetingLink(undefined)} aria-label="Cerrar aviso" className="text-muted"><CloseIcon size={14} /></button>
          </span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.isPending && <p className="text-xs text-muted">Cargando mensajes…</p>}
        {messages.isError && <Alert>No pudimos cargar los mensajes.</Alert>}
        {messages.data && all.length >= 50 && hasOlder && (
          <div className="mb-3 text-center">
            <button type="button" onClick={() => loadOlder.mutate()} disabled={loadOlder.isPending} className="text-xs text-muted underline">Cargar mensajes anteriores</button>
          </div>
        )}
        {messages.data && !all.length && (
          <div className="grid h-full place-items-center text-center">
            <p className="text-xs text-muted">{chat.kind === 'notes' ? 'Anota ideas, pendientes o lo que quieras recordar.' : 'Escribe el primer mensaje.'}</p>
          </div>
        )}
        <ol className="flex flex-col gap-1">
          {all.map((message, index) => {
            const previous = all[index - 1];
            const newDay = !previous || date(previous.createdAt) !== date(message.createdAt);
            const sameAuthor = previous && !newDay && previous.authorId === message.authorId;
            return (
              <Fragment key={message.id}>
                {newDay && <li className="my-2 text-center text-[11px] font-medium text-muted">{dayLabel(message.createdAt, date)}</li>}
                <Bubble message={message} showAuthor={!message.mine && !sameAuthor && chat.kind !== 'direct'} time={time(message.createdAt)} onDelete={() => remove.mutate(message.id)} />
              </Fragment>
            );
          })}
        </ol>
        <div ref={bottom} />
      </div>
      <Composer onSend={(body) => send.mutateAsync(body)} sending={send.isPending} error={send.error} placeholder={chat.kind === 'notes' ? 'Escribe una nota…' : `Escribe a ${chat.title}…`} />
    </>
  );
}

function Bubble({ message, showAuthor, time, onDelete }: { message: TeamMessage; showAuthor: boolean; time: string; onDelete: () => void }) {
  return (
    <li className={`group flex ${message.mine ? 'justify-end' : 'justify-start'} ${showAuthor ? 'mt-2' : ''}`}>
      <div className={`max-w-[min(32rem,85%)] rounded-2xl px-3 py-2 text-sm ${message.mine ? 'rounded-br-md bg-honey-soft text-ink' : 'rounded-bl-md bg-raised text-ink'}`}>
        {showAuthor && <p className="mb-0.5 text-[11px] font-semibold text-muted">{message.authorName ?? 'Ex miembro'}</p>}
        {message.deleted
          ? <p className="italic text-muted">Mensaje eliminado</p>
          : <p className="whitespace-pre-wrap break-words">{linkify(message.body).map((part, i) => part.href
            ? <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" className="underline">{part.text}</a>
            : <Fragment key={i}>{part.text}</Fragment>)}</p>}
        <p className="mt-0.5 flex items-center justify-end gap-2 text-[10px] text-muted">
          {message.canDelete && (
            <button type="button" onClick={() => confirm('¿Borrar este mensaje? Lo verán como "Mensaje eliminado".') && onDelete()} aria-label="Borrar mensaje" className="opacity-0 transition hover:text-danger focus:opacity-100 group-hover:opacity-100">
              <TrashIcon size={12} />
            </button>
          )}
          {time}
        </p>
      </div>
    </li>
  );
}

function Composer({ onSend, sending, error, placeholder }: { onSend: (body: string) => Promise<unknown>; sending: boolean; error: unknown; placeholder: string }) {
  const [text, setText] = useState('');
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    await onSend(body);
    setText('');
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }
  return (
    <form onSubmit={submit} className="border-t border-line p-3">
      {Boolean(error) && <div className="mb-2"><Alert>{error instanceof ApiError ? error.message : 'No pudimos enviar el mensaje.'}</Alert></div>}
      <div className="flex items-end gap-2 rounded-xl border border-line bg-canvas p-1.5 focus-within:border-honey focus-within:ring-2 focus-within:ring-honey/30">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={Math.min(5, Math.max(1, text.split('\n').length))}
          maxLength={4000}
          placeholder={placeholder}
          aria-label="Mensaje"
          className="min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink outline-none placeholder:text-muted"
        />
        <button type="submit" disabled={!text.trim() || sending} aria-label="Enviar" className="grid size-9 place-items-center rounded-lg bg-honey text-on-honey transition hover:brightness-95 disabled:opacity-40">
          <SendIcon size={16} />
        </button>
      </div>
      <p className="mt-1 px-1 text-[10px] text-muted">Enter envía · Shift + Enter, nueva línea</p>
    </form>
  );
}

interface DealOption { id: string; title: string; contact: { name: string } | null }

function NewChatDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const myId = authClient.useSession().data?.user.id;
  const presence = useTeamPresence();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [dealQuery, setDealQuery] = useState('');
  const [deal, setDeal] = useState<DealOption>();
  const q = useDebouncedValue(dealQuery.trim());
  const deals = useQuery({ queryKey: ['deal-options', q], queryFn: () => api<{ items: DealOption[] }>(`/api/v1/deals?q=${encodeURIComponent(q)}&limit=8`), enabled: q.length >= 2 && !deal });
  const create = useMutation({
    mutationFn: () => api<TeamChat>('/api/v1/team-chats', {
      method: 'POST',
      body: JSON.stringify({ userIds: picked, ...(title.trim() ? { title: title.trim() } : {}), ...(deal ? { dealId: deal.id } : {}) }),
    }),
    onSuccess: (chat) => {
      void queryClient.invalidateQueries({ queryKey: ['team-chats'] });
      onCreated(chat.id);
    },
  });
  const colleagues = presence.data?.filter((p) => p.userId !== myId) ?? [];
  const isGroup = picked.length > 1 || Boolean(deal) || Boolean(title.trim());

  return (
    <div role="dialog" aria-modal="true" aria-label="Nuevo chat" className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-scrim/60 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">Nuevo chat</h2>
            <p className="mt-1 text-xs text-muted">Una persona abre un chat directo; varias, un nombre o un negocio, un grupo.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted hover:text-ink"><CloseIcon size={18} /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (picked.length) create.mutate(); }} className="flex flex-col gap-4 p-5">
          <fieldset>
            <legend className="text-xs font-semibold text-muted">Con quién</legend>
            {!colleagues.length && <p className="mt-1.5 text-xs text-muted">Todavía no hay más personas en tu equipo. Invítalas desde Equipo.</p>}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {colleagues.map((p) => {
                const checked = picked.includes(p.userId);
                return (
                  <label key={p.userId} className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-xs ${checked ? 'border-honey bg-honey-soft text-ink' : 'border-line text-muted'}`}>
                    <input type="checkbox" checked={checked} onChange={() => setPicked((list) => (checked ? list.filter((id) => id !== p.userId) : [...list, p.userId]))} className="size-3.5 accent-honey" />
                    <PresenceDot status={p.status} className="size-2" />
                    {p.name}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <label className={labelClass}>
            Nombre del grupo (opcional)
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Ventas zona norte" className={inputClass} />
          </label>
          <div className="relative flex flex-col gap-1.5">
            <label htmlFor="chat-deal" className="text-xs font-semibold text-muted">Negocio adjunto (opcional)</label>
            {deal ? (
              <p className="flex min-h-10 items-center justify-between gap-2 rounded-lg border border-line px-3 text-sm text-ink">
                <span className="truncate">{deal.title}</span>
                <button type="button" onClick={() => setDeal(undefined)} className="text-xs text-muted underline">Quitar</button>
              </p>
            ) : (
              <input id="chat-deal" value={dealQuery} onChange={(e) => setDealQuery(e.target.value)} placeholder="Busca por negocio o cliente" autoComplete="off" className={inputClass} />
            )}
            {!deal && Boolean(deals.data?.items.length) && (
              <ul role="listbox" className="absolute top-full z-10 mt-1 w-full rounded-lg border border-line bg-surface shadow-lg">
                {deals.data!.items.map((d) => (
                  <li key={d.id}><button type="button" onClick={() => setDeal(d)} className="min-h-10 w-full px-3 text-left text-sm text-ink hover:bg-canvas">{d.title} <span className="text-xs text-muted">{d.contact?.name}</span></button></li>
                ))}
              </ul>
            )}
          </div>
          {create.isError && <Alert>{create.error instanceof ApiError ? create.error.message : 'No pudimos crear el chat.'}</Alert>}
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <button type="button" onClick={onClose} className={secondaryButton}>Cancelar</button>
            <button type="submit" disabled={!picked.length || create.isPending} className={primaryButton}>{isGroup ? 'Crear grupo' : 'Abrir chat'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
