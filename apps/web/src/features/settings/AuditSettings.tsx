import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../shared/api';
import { useRegion } from '../../shared/i18n/use-region';

interface Entry { id: number; action: string; entity: string; entityId: string | null; actorName: string | null; data: { fields?: string[] }; ip: string | null; createdAt: string }
interface Page { items: Entry[]; nextCursor: string | null }

const ACTIONS: Record<string, string> = {
  view: 'Vio', create: 'Creó', update: 'Modificó', delete: 'Eliminó', export: 'Exportó', import: 'Importó', merge: 'Fusionó',
  move: 'Movió', close: 'Cerró', reopen: 'Reabrió', payment_method: 'Cambió la tarjeta',
};
const ENTITIES: Record<string, string> = {
  contacts: 'contacto', companies: 'organización', deals: 'negocio', tasks: 'tarea', conversations: 'conversación',
  pipelines: 'embudo', members: 'miembro del equipo', invitations: 'invitación', subscription: 'suscripción',
};
const FILTERS = [['', 'Todo'], ['view', 'Vistas'], ['update', 'Cambios'], ['delete', 'Eliminaciones'], ['export', 'Exportaciones']] as const;

/** E13-S06 — Registro de auditoría: quién vio, modificó, exportó o eliminó datos. Solo lectura. */
export function AuditSettings() {
  const { date, time } = useRegion();
  const [action, setAction] = useState('');
  const log = useInfiniteQuery({
    queryKey: ['audit', action],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<Page>(`/api/v1/audit?limit=30${action ? `&action=${action}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });

  if (log.isError) return null; // solo el propietario
  const items = log.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section className="mt-10" aria-labelledby="audit-title">
      <h2 id="audit-title" className="text-lg font-semibold text-ink">Registro de auditoría</h2>
      <p className="mt-1 text-sm text-muted">Quién vio, modificó, exportó o eliminó datos. Nadie puede editarlo ni borrarlo.</p>
      <div className="mt-3 flex gap-2 overflow-x-auto" role="group" aria-label="Filtrar">
        {FILTERS.map(([value, label]) => (
          <button key={value} onClick={() => setAction(value)} aria-pressed={action === value}
            className={`min-h-11 shrink-0 rounded-full border px-4 text-sm ${action === value ? 'border-ink bg-ink text-surface' : 'border-line text-ink'}`}>{label}</button>
        ))}
      </div>
      <ol className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface">
        {items.map((e) => (
          <li key={e.id} className="px-4 py-2.5 text-sm">
            <p className="text-ink">
              <strong>{e.actorName ?? 'Sistema'}</strong> {(ACTIONS[e.action] ?? e.action).toLowerCase()} {ENTITIES[e.entity] ?? e.entity}
              {e.data.fields?.length ? <span className="text-muted"> ({e.data.fields.join(', ')})</span> : null}
            </p>
            <p className="text-xs text-muted">{date(e.createdAt)} {time(e.createdAt)}{e.ip ? ` · IP ${e.ip}` : ''}</p>
          </li>
        ))}
        {log.isSuccess && !items.length && <li className="px-4 py-3 text-sm text-muted">Sin registros.</li>}
      </ol>
      {log.hasNextPage && (
        <button onClick={() => log.fetchNextPage()} className="mt-2 inline-flex min-h-11 items-center text-sm text-ink underline">
          {log.isFetchingNextPage ? 'Cargando…' : 'Ver más'}
        </button>
      )}
    </section>
  );
}
