import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api';
import { Alert } from '../../shared/ui/form';

interface Preference { type: string; label: string; inApp: boolean; email: boolean; emailLocked: boolean }

/** E14-S04 — Qué avisos recibe cada persona, en la app y por correo. */
export function NotificationSettings() {
  const queryClient = useQueryClient();
  const prefs = useQuery({ queryKey: ['notification-preferences'], queryFn: () => api<Preference[]>('/api/v1/notifications/preferences') });
  const save = useMutation({
    mutationFn: (p: Pick<Preference, 'type' | 'inApp' | 'email'>) => api<Preference[]>('/api/v1/notifications/preferences', { method: 'PUT', body: JSON.stringify(p) }),
    onSuccess: (data) => queryClient.setQueryData(['notification-preferences'], data),
  });

  if (!prefs.data) return null;

  return (
    <section className="mt-10" aria-labelledby="notif-title">
      <h2 id="notif-title" className="text-lg font-semibold text-ink">Mis notificaciones</h2>
      <p className="mt-1 text-sm text-muted">Elegí qué avisos te llegan a la campana y cuáles por correo. Solo te afecta a vos.</p>
      <table className="mt-3 w-full text-left text-sm">
        <thead className="text-xs text-muted"><tr><th scope="col" className="py-2">Aviso</th><th scope="col" className="w-20 text-center">En la app</th><th scope="col" className="w-20 text-center">Correo</th></tr></thead>
        <tbody className="divide-y divide-line">
          {prefs.data.map((p) => (
            <tr key={p.type}>
              <td className="py-2 text-ink">{p.label}</td>
              <td className="text-center">
                <input type="checkbox" aria-label={`${p.label} en la app`} checked={p.inApp} onChange={(e) => save.mutate({ type: p.type, inApp: e.target.checked, email: p.email })} className="size-5 accent-honey" />
              </td>
              <td className="text-center">
                <input type="checkbox" aria-label={`${p.label} por correo`} checked={p.email} disabled={p.emailLocked} title={p.emailLocked ? 'Los avisos de plan y pagos siempre llegan por correo' : undefined}
                  onChange={(e) => save.mutate({ type: p.type, inApp: p.inApp, email: e.target.checked })} className="size-5 accent-honey" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {save.isError && <div className="mt-2"><Alert>No se pudo guardar.</Alert></div>}
    </section>
  );
}
