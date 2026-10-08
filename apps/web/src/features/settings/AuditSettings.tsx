import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../shared/api';
import { linkButton, Segmented, SettingsSection } from '../../shared/ui/section';
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
  const [action, setAction] = useState<(typeof FILTERS)[number][0]>('');
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
    <SettingsSection icon="☰" title="Registro de auditoría" description="Quién vio, modificó, exportó o eliminó datos. Nadie puede editarlo ni borrarlo.">
      <Segmented label="Filtrar el registro" options={FILTERS} value={action} onChange={setAction} />
      <ol className="mt-3 divide-y divide-line rounded-lg border border-line">
        {items.map((e) => (
          <li key={e.id} className="px-3 py-2.5 text-xs">
            <p className="text-ink">
              <strong>{e.actorName ?? 'Sistema'}</strong> {(ACTIONS[e.action] ?? e.action).toLowerCase()} {ENTITIES[e.entity] ?? e.entity}
              {e.data.fields?.length ? <span className="text-muted"> ({e.data.fields.join(', ')})</span> : null}
            </p>
            <p className="mt-0.5 text-[11px] text-muted">{date(e.createdAt)} {time(e.createdAt)}{e.ip ? ` · IP ${e.ip}` : ''}</p>
          </li>
        ))}
        {log.isSuccess && !items.length && <li className="px-3 py-3 text-xs text-muted">Sin registros con este filtro.</li>}
      </ol>
      {log.hasNextPage && (
        <button onClick={() => log.fetchNextPage()} className={`${linkButton} mt-2`}>
          {log.isFetchingNextPage ? 'Cargando…' : 'Ver más'}
        </button>
      )}
    </SettingsSection>
  );
}
