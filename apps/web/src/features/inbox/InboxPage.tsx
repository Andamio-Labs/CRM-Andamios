import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api';
import { authClient } from '../../shared/auth-client';
import { useRegion } from '../../shared/i18n/use-region';
import { useRealtime } from '../../shared/realtime';
import { AppShell } from '../../shared/ui/app-shell';
import { Alert } from '../../shared/ui/form';
import { Composer } from './Composer';
import { type ConversationWindow, windowLabel } from './window';

interface Conversation {
  id: string;
  unreadCount: number;
  lastMessageAt: string;
  assignedTo: string | null;
  window: ConversationWindow;
  contact: { id: string; name: string; phone: string | null };
}
interface Message {
  id: string;
  direction: 'in' | 'out' | 'note';
  type: string;
  body: string | null;
  status: string;
  error: { message: string } | null;
  media: { status: string; mimeType: string | null; url?: string } | null;
  createdAt: string;
}
interface Member { userId: string; name: string }
type Filter = 'all' | 'unread' | 'mine' | 'unassigned';

const FILTERS: [Filter, string][] = [['all', 'Todas'], ['unread', 'No leídas'], ['mine', 'Mías'], ['unassigned', 'Sin asignar']];
const STATUS_LABEL: Record<string, string> = { pending: 'Enviando…', sent: 'Enviado', delivered: 'Entregado', read: 'Leído', failed: 'No enviado' };

/** E04-S07 — Bandeja con filtros, contadores y asignación. */
export function InboxPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string>();
  const conversations = useQuery({ queryKey: ['conversations', filter], queryFn: () => api<Conversation[]>(`/api/v1/conversations?filter=${filter}`) });
  const counts = useQuery({ queryKey: ['conversation-counts'], queryFn: () => api<Record<'unread' | 'mine' | 'unassigned', number>>('/api/v1/conversations/counts') });

  useRealtime(['message.created', 'message.updated', 'conversation.assigned'], (event) => {
    void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    void queryClient.invalidateQueries({ queryKey: ['conversation-counts'] });
    if (event.conversationId) void queryClient.invalidateQueries({ queryKey: ['messages', event.conversationId] });
  });

  const current = conversations.data?.find((c) => c.id === selected);
  return (
    <AppShell title="Conversaciones" subtitle="Mensajes de WhatsApp de tus clientes." wide>
      <div role="tablist" aria-label="Filtrar conversaciones" className={`mb-3 flex gap-1 overflow-x-auto ${current ? 'hidden lg:flex' : ''}`}>
        {FILTERS.map(([key, label]) => {
          const count = key === 'all' ? undefined : counts.data?.[key];
          return (
            <button
              key={key}
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className={`min-h-11 shrink-0 rounded-lg px-3 text-sm ${filter === key ? 'bg-honey font-semibold text-ink' : 'bg-surface text-muted'}`}
            >
              {label}{count ? ` (${count})` : ''}
            </button>
          );
        })}
      </div>

      {conversations.isPending && <p className="text-muted">Cargando conversaciones…</p>}
      {conversations.isError && <Alert>No pudimos cargar las conversaciones. Recarga la página.</Alert>}
      {conversations.data?.length === 0 && (
        <p className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-muted">
          {filter === 'all' ? 'Todavía no hay conversaciones. Conecta tu número en Configuración y aparecerán los mensajes de tus clientes.' : 'No hay conversaciones con este filtro.'}
        </p>
      )}
      {Boolean(conversations.data?.length) && (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <ul className={`divide-y divide-line rounded-xl border border-line bg-surface ${current ? 'hidden lg:block' : ''}`}>
            {conversations.data!.map((c) => (
              <li key={c.id}>
                <button onClick={() => setSelected(c.id)} className={`flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left ${c.id === selected ? 'bg-canvas' : ''}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{c.contact.name}</span>
                    <span className="block truncate text-sm text-muted">{c.contact.phone}</span>
                  </span>
                  {c.unreadCount > 0 && <span className="rounded-full bg-honey px-2 py-0.5 text-xs font-semibold text-ink" aria-label={`${c.unreadCount} sin leer`}>{c.unreadCount}</span>}
                </button>
              </li>
            ))}
          </ul>
          {current ? <Thread conversation={current} onBack={() => setSelected(undefined)} /> : <p className="hidden self-center text-center text-muted lg:block">Elige una conversación.</p>}
        </div>
      )}
    </AppShell>
  );
}

function Thread({ conversation, onBack }: { conversation: Conversation; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { time } = useRegion();
  const [now, setNow] = useState(() => new Date());
  const bottom = useRef<HTMLDivElement>(null);
  const messages = useQuery({ queryKey: ['messages', conversation.id], queryFn: () => api<Message[]>(`/api/v1/conversations/${conversation.id}/messages`) });

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (conversation.unreadCount > 0) void api(`/api/v1/conversations/${conversation.id}/read`, { method: 'POST' }).then(() => queryClient.invalidateQueries({ queryKey: ['conversations'] }));
  }, [conversation.id, conversation.unreadCount, queryClient]);
  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [messages.data?.length]);

  const label = windowLabel(conversation.window, now);
  const toneClass = { open: 'bg-success/10 text-success', closing: 'bg-honey/20 text-ink', closed: 'bg-danger/10 text-danger' }[label.tone];
  return (
    <section className="flex min-h-[70dvh] flex-col rounded-xl border border-line bg-surface md:min-h-[60dvh]" aria-label={`Conversación con ${conversation.contact.name}`}>
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <button onClick={onBack} className="inline-flex min-h-11 items-center px-1 text-sm text-muted underline md:hidden">Volver</button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-ink">{conversation.contact.name}</p>
          <p className="text-sm text-muted">{conversation.contact.phone}</p>
        </div>
        <Assignment conversation={conversation} />
      </header>
      <p role="status" className={`px-4 py-2 text-sm ${toneClass}`}>{label.text}</p>

      <ol className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
        {messages.isPending && <li className="text-muted">Cargando mensajes…</li>}
        {messages.isError && <li><Alert>No pudimos cargar los mensajes.</Alert></li>}
        {messages.data?.map((m) => (
          <li
            key={m.id}
            className={`max-w-[85%] rounded-lg px-3 py-2 ${m.direction === 'out' ? 'self-end bg-honey/25' : m.direction === 'note' ? 'self-center border border-dashed border-line bg-surface' : 'self-start bg-canvas'}`}
          >
            {m.direction === 'note' && <p className="text-xs font-medium text-muted">Nota interna</p>}
            {m.media && <MediaView media={m.media} />}
            {m.body && <p className="whitespace-pre-wrap break-words text-ink">{m.body}</p>}
            <p className="mt-1 text-right text-xs text-muted">
              {time(m.createdAt)}
              {m.direction === 'out' && ` · ${STATUS_LABEL[m.status] ?? m.status}`}
            </p>
            {m.error && <p className="mt-1 text-xs text-danger">{m.error.message}</p>}
          </li>
        ))}
        <div ref={bottom} />
      </ol>

      <Composer conversationId={conversation.id} windowOpen={label.tone !== 'closed'} contact={conversation.contact} />
    </section>
  );
}

/** E04-S06 — Reproduce en línea solo lo seguro; el resto se ofrece como descarga. */
function MediaView({ media }: { media: NonNullable<Message['media']> }) {
  if (media.status === 'pending') return <p className="text-sm text-muted">Descargando archivo…</p>;
  if (media.status === 'too_large') return <p className="text-sm text-muted">Archivo demasiado grande para guardarlo.</p>;
  if (!media.url) return <p className="text-sm text-danger">No se pudo obtener el archivo.</p>;
  const type = media.mimeType ?? '';
  if (type.startsWith('audio/')) return <audio controls preload="none" src={media.url} className="w-64 max-w-full" aria-label="Nota de voz" />;
  if (type.startsWith('image/') && type !== 'image/svg+xml') return <img src={media.url} alt="Imagen enviada por el cliente" className="max-h-72 rounded-md" loading="lazy" />;
  if (type.startsWith('video/')) return <video controls preload="none" src={media.url} className="max-h-72 rounded-md" />;
  return <a href={media.url} className="inline-flex min-h-11 items-center text-sm text-ink underline" download>Descargar archivo</a>;
}

/** E04-S07 — Propietario/admin asignan a cualquiera; el vendedor toma las libres. */
function Assignment({ conversation }: { conversation: Conversation }) {
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const me = session.data?.user.id;
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<Member[]>('/api/v1/members'), retry: false, staleTime: 60_000 });
  const assign = useMutation({
    mutationFn: (userId: string | null) => api(`/api/v1/conversations/${conversation.id}/assignment`, { method: 'PATCH', body: JSON.stringify({ userId }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['conversation-counts'] });
    },
  });

  if (members.data) {
    return (
      <label className="flex items-center gap-2 text-sm text-muted">
        Asignada a
        <select value={conversation.assignedTo ?? ''} onChange={(e) => assign.mutate(e.target.value || null)} className="h-11 rounded-md border border-line bg-surface px-2 text-ink">
          <option value="">Sin asignar</option>
          {members.data.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
        </select>
      </label>
    );
  }
  if (!conversation.assignedTo && me) {
    return <button onClick={() => assign.mutate(me)} className="min-h-11 rounded-lg border border-line px-3 text-sm text-ink">Tomar conversación</button>;
  }
  return <span className="text-sm text-muted">{conversation.assignedTo === me ? 'Asignada a ti' : 'Asignada a otra persona'}</span>;
}
