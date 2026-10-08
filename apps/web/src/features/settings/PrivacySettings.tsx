import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api';
import { Badge, EmptyState, linkButton, SettingsSection } from '../../shared/ui/section';
import { useRegion } from '../../shared/i18n/use-region';

interface Request { id: string; type: 'access' | 'update' | 'erase' | 'export'; channel: string; details: string | null; dueAt: string; contactName: string | null; createdAt: string }

const TYPES = { access: 'Consulta', export: 'Copia de sus datos', update: 'Corrección', erase: 'Supresión' } as const;

/** E13-S03 — Solicitudes de titulares abiertas, ordenadas por vencimiento del plazo legal. */
export function PrivacySettings() {
  const { date } = useRegion();
  const queryClient = useQueryClient();
  const requests = useQuery({ queryKey: ['privacy-requests'], queryFn: () => api<Request[]>('/api/v1/privacy/requests?status=open'), retry: false });
  const resolve = useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: string }) =>
      api(`/api/v1/privacy/requests/${id}/resolve`, { method: 'POST', body: JSON.stringify({ status: 'resolved', resolution }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['privacy-requests'] }),
  });

  if (requests.isError || !requests.data) return null;

  return (
    <SettingsSection icon="⚖" title="Solicitudes de titulares" description="Ley 1581: consultas en 10 días hábiles y reclamos (corrección o supresión) en 15. Se registran desde la ficha del contacto.">
      {!requests.data.length && <EmptyState icon="✓" title="No hay solicitudes abiertas">Cuando un cliente pida ver, corregir o borrar sus datos, regístralo desde su ficha.</EmptyState>}
      <ul className="flex flex-col divide-y divide-line">
        {requests.data.map((r) => {
          const overdue = Date.parse(r.dueAt) < Date.now();
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2.5 text-xs">
              <span className="min-w-0 flex-1 text-ink"><strong>{TYPES[r.type]}</strong> · {r.contactName ?? 'Contacto eliminado'}{r.details ? <span className="text-muted"> · {r.details}</span> : null}</span>
              <Badge tone={overdue ? 'danger' : 'neutral'}>{overdue ? 'Vencida' : 'Vence'} el {date(r.dueAt)}</Badge>
              <button onClick={() => { const resolution = prompt('¿Cómo se atendió?'); if (resolution && resolution.trim().length >= 3) resolve.mutate({ id: r.id, resolution }); }}
                className={linkButton}>Marcar atendida</button>
            </li>
          );
        })}
      </ul>
    </SettingsSection>
  );
}
