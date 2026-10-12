import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../shared/api';
import { disablePush, enablePush, type PushState, pushState } from '../../shared/push';
import { Alert } from '../../shared/ui/form';

type Channel = 'inApp' | 'email' | 'push';
interface Preference { type: string; label: string; description: string; inApp: boolean; email: boolean; push: boolean; emailLocked: boolean }

const CHANNELS: { id: Channel; label: string }[] = [
  { id: 'inApp', label: 'En el CRM' },
  { id: 'email', label: 'Correo' },
  { id: 'push', label: 'Push' },
];
const EMAIL_LOCKED = 'Los avisos de plan y pagos siempre llegan por correo';
const KEY = ['notification-preferences'];

/** E14-S04 — Qué avisos recibe cada persona y por qué canal: campana, correo y push. */
export function NotificationSettings() {
  const queryClient = useQueryClient();
  const prefs = useQuery({ queryKey: KEY, queryFn: () => api<Preference[]>('/api/v1/notifications/preferences') });
  const save = useMutation({
    mutationFn: (p: Pick<Preference, 'type' | Channel>) => api<Preference[]>('/api/v1/notifications/preferences', { method: 'PUT', body: JSON.stringify(p) }),
    // El interruptor responde al instante; si la API falla, vuelve a como estaba.
    onMutate: async (p) => {
      await queryClient.cancelQueries({ queryKey: KEY });
      const before = queryClient.getQueryData<Preference[]>(KEY);
      queryClient.setQueryData<Preference[]>(KEY, (rows) => rows?.map((r) => (r.type === p.type ? { ...r, ...p } : r)));
      return { before };
    },
    onError: (_e, _p, ctx) => queryClient.setQueryData(KEY, ctx?.before),
    onSuccess: (data) => queryClient.setQueryData(KEY, data),
  });

  function toggle(p: Preference, channel: Channel, value: boolean) {
    save.mutate({ type: p.type, inApp: p.inApp, email: p.email, push: p.push, [channel]: value });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,27rem)]">
      <section aria-labelledby="notif-title" className="min-w-0">
        <h2 id="notif-title" className="text-xl font-bold tracking-tight text-ink">Notificaciones</h2>
        <p className="mt-2 text-sm text-muted">Elige qué te avisamos y por dónde. Tus preferencias solo te afectan a ti. Los avisos de plan y pagos siempre llegan por correo.</p>

        {prefs.isPending && <p className="mt-6 text-sm text-muted">Cargando…</p>}
        {prefs.isError && <div className="mt-4"><Alert>No pudimos cargar tus preferencias.</Alert></div>}
        {prefs.data && (
          <div className="mt-5 overflow-x-auto border-t border-line">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line text-sm text-muted">
                  <th scope="col" className="py-3.5 pr-4 font-normal">Tipo</th>
                  {CHANNELS.map((c) => <th key={c.id} scope="col" className="w-20 px-1 py-3.5 text-center font-normal sm:w-24">{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {prefs.data.map((p) => (
                  <tr key={p.type} className="border-b border-line">
                    <th scope="row" className="py-3.5 pr-4 text-left font-normal">
                      <span className="block text-sm text-ink">{p.label}</span>
                      <span className="mt-1 block text-sm text-muted">{p.description}</span>
                    </th>
                    {CHANNELS.map((c) => {
                      const locked = c.id === 'email' && p.emailLocked;
                      return (
                        <td key={c.id} className="px-1 py-3.5 text-center">
                          <Switch
                            label={`${p.label}: ${c.label}`}
                            checked={p[c.id]}
                            disabled={locked}
                            title={locked ? EMAIL_LOCKED : undefined}
                            onChange={(value) => toggle(p, c.id, value)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {save.isError && <div className="mt-3"><Alert>No se pudo guardar el cambio. Inténtalo de nuevo.</Alert></div>}
      </section>

      <aside className="flex flex-col gap-4">
        <PushDeviceCard />
        <section aria-labelledby="channels-help" className="rounded-xl border border-line bg-surface p-5">
          <h3 id="channels-help" className="text-sm font-medium text-ink">Cómo funcionan los canales</h3>
          <ul className="mt-3 flex flex-col gap-2.5 pl-4 text-sm leading-relaxed text-muted">
            <li>«En el CRM» es la campana del encabezado. Si lo apagas, el aviso no aparece ahí, pero puede seguir llegando por los otros canales.</li>
            <li>Correo: llega al correo con el que inicias sesión. Los avisos de plan y pagos siempre llegan por correo.</li>
            <li>Push: una notificación del sistema en el navegador o el teléfono, incluso con la pestaña cerrada. Se activa por separado en cada dispositivo.</li>
          </ul>
        </section>
      </aside>
    </div>
  );
}

const PUSH_COPY: Record<PushState, string> = {
  unsupported: 'Este navegador no admite notificaciones push. Prueba con Chrome, Edge, Firefox o Safari actualizados.',
  unconfigured: 'El envío de notificaciones push todavía no está configurado en el servidor.',
  denied: 'El navegador bloqueó las notificaciones de este sitio. Permítelas en la configuración del sitio y vuelve a intentarlo.',
  off: 'Recibe los avisos como notificación del sistema, aunque tengas la pestaña cerrada.',
  on: 'Activas en este dispositivo. Los tipos con Push encendido te llegarán aquí.',
};

/** Estado del push en ESTE navegador: se pide permiso y se suscribe al tocar el botón. */
function PushDeviceCard() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const config = useQuery({ queryKey: ['push-config'], queryFn: () => api<{ publicKey: string | null }>('/api/v1/notifications/push/config'), staleTime: Infinity });
  const publicKey = config.data?.publicKey ?? null;
  const state = useQuery({ queryKey: ['push-state', publicKey], queryFn: () => pushState(publicKey), enabled: config.isSuccess });
  const change = useMutation({
    mutationFn: (on: boolean) => (on ? enablePush(publicKey!) : disablePush()),
    onMutate: () => setError(null),
    onSuccess: (next) => queryClient.setQueryData(['push-state', publicKey], next),
    onError: () => setError('No pudimos cambiar el push en este dispositivo. Inténtalo de nuevo.'),
  });

  const current = state.data;
  return (
    <section aria-labelledby="push-device" className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <h3 id="push-device" className="flex items-center gap-2 text-sm font-medium text-ink">
            Push en este dispositivo
            {current === 'on' && <span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-semibold text-success">Activo</span>}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{current ? PUSH_COPY[current] : 'Revisando el navegador…'}</p>
        </div>
        {current === 'off' && <button onClick={() => change.mutate(true)} disabled={change.isPending} className={honeyPill}>{change.isPending ? 'Activando…' : 'Activar push'}</button>}
        {current === 'denied' && <button onClick={() => void state.refetch()} className={honeyPill}>Volver a revisar</button>}
        {current === 'on' && <button onClick={() => change.mutate(false)} disabled={change.isPending} className="shrink-0 rounded-lg border border-line px-4 py-1.5 text-sm font-semibold text-ink transition hover:bg-raised disabled:opacity-60">Desactivar</button>}
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </section>
  );
}

const honeyPill = 'shrink-0 rounded-lg bg-honey px-4 py-1.5 text-sm font-semibold text-on-honey shadow-[0_0_14px_rgb(245_183_0/0.35)] transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-60';

function Switch({ label, checked, disabled, title, onChange }: { label: string; checked: boolean; disabled?: boolean; title?: string; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60 ${checked ? 'bg-honey' : 'bg-line'}`}
    >
      <span aria-hidden className={`absolute left-0 size-[1.125rem] rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[1.5rem]' : 'translate-x-[0.1875rem]'}`} />
    </button>
  );
}
