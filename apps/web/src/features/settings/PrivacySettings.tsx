import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api';
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
    <section className="mt-10" aria-labelledby="privacy-title">
      <h2 id="privacy-title" className="text-lg font-semibold text-ink">Solicitudes de titulares</h2>
      <p className="mt-1 text-sm text-muted">Ley 1581: consultas en 10 días hábiles y reclamos (corrección o supresión) en 15. Se registran desde la ficha del contacto.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {requests.data.map((r) => {
          const overdue = Date.parse(r.dueAt) < Date.now();
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
              <span className="min-w-0 flex-1 text-ink"><strong>{TYPES[r.type]}</strong> · {r.contactName ?? 'Contacto eliminado'}{r.details ? <span className="text-muted"> · {r.details}</span> : null}</span>
              <span className={overdue ? 'font-semibold text-danger' : 'text-muted'}>{overdue ? 'Vencida' : 'Vence'} el {date(r.dueAt)}</span>
              <button onClick={() => { const resolution = prompt('¿Cómo se atendió?'); if (resolution && resolution.trim().length >= 3) resolve.mutate({ id: r.id, resolution }); }}
                className="inline-flex min-h-11 items-center px-2 text-ink underline">Marcar atendida</button>
            </li>
          );
        })}
        {!requests.data.length && <li className="text-sm text-muted">No hay solicitudes abiertas.</li>}
      </ul>
    </section>
  );
}
