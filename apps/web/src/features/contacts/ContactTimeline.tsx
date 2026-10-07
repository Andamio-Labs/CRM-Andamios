import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../shared/api';
import { useRegion } from '../../shared/i18n/use-region';
import { Alert } from '../../shared/ui/form';

interface TimelineItem { kind: 'message' | 'note' | 'deal'; id: string; at: string; summary: string; data: { direction?: string; dealTitle?: string } }
interface Page { items: TimelineItem[]; nextCursor: string | null }

const KIND_LABEL = { message: 'Mensaje', note: 'Nota interna', deal: 'Negocio' } as const;

/** E02-S05 — Línea de tiempo del contacto, más reciente primero, con "Ver más". */
export function ContactTimeline({ contactId }: { contactId: string }) {
  const { date, time } = useRegion();
  const timeline = useInfiniteQuery({
    queryKey: ['timeline', contactId],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<Page>(`/api/v1/contacts/${contactId}/timeline?limit=20${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (timeline.isPending) return <p className="text-sm text-muted">Cargando historial…</p>;
  if (timeline.isError) return <Alert>No pudimos cargar el historial.</Alert>;
  const items = timeline.data.pages.flatMap((p) => p.items);
  if (!items.length) return <p className="text-sm text-muted">Sin actividad todavía.</p>;

  return (
    <div>
      <ol className="flex flex-col gap-3 border-l-2 border-line pl-4">
        {items.map((item) => (
          <li key={`${item.kind}:${item.id}`}>
            <p className="text-xs text-muted">
              {KIND_LABEL[item.kind]}
              {item.kind === 'message' && (item.data.direction === 'in' ? ' recibido' : ' enviado')}
              {item.kind === 'deal' && item.data.dealTitle ? ` · ${item.data.dealTitle}` : ''}
              {' · '}{date(item.at)} {time(item.at)}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm text-ink">{item.summary}</p>
          </li>
        ))}
      </ol>
      {timeline.hasNextPage && (
        <button onClick={() => timeline.fetchNextPage()} className="mt-3 inline-flex min-h-11 items-center text-sm text-ink underline">
          {timeline.isFetchingNextPage ? 'Cargando…' : 'Ver más'}
        </button>
      )}
    </div>
  );
}
