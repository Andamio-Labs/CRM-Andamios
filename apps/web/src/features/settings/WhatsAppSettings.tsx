import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { Alert, Button, Field } from '../../shared/ui/form';

interface Channel {
  id: string;
  phoneNumberId: string;
  displayPhone: string | null;
  verifiedName: string | null;
  nameStatus: string | null;
  qualityRating: string | null;
  messagingLimit: string | null;
  status: 'connected' | 'disconnected' | 'error';
}

const QUALITY: Record<string, string> = { GREEN: 'Alta', YELLOW: 'Media', RED: 'Baja', UNKNOWN: 'Sin datos' };
const META_APP_ID = import.meta.env.VITE_META_APP_ID as string | undefined;
const META_CONFIG_ID = import.meta.env.VITE_META_CONFIG_ID as string | undefined;

declare global {
  interface Window {
    FB?: { init(o: object): void; login(cb: (r: { authResponse?: { code?: string } }) => void, o: object): void };
  }
}

/** E04-S01 — Conectar el número de WhatsApp (Embedded Signup) y ver su estado y calidad. */
export function WhatsAppSettings() {
  const queryClient = useQueryClient();
  const channels = useQuery({ queryKey: ['wa-channels'], queryFn: () => api<Channel[]>('/api/v1/whatsapp/channels') });
  const connect = useMutation({
    mutationFn: (body: { code: string; wabaId: string; phoneNumberId: string }) => api('/api/v1/whatsapp/channels', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wa-channels'] }),
  });
  const refresh = useMutation({
    mutationFn: (id: string) => api(`/api/v1/whatsapp/channels/${id}/refresh`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wa-channels'] }),
  });

  return (
    <section className="mt-10" aria-labelledby="wa-title">
      <h2 id="wa-title" className="text-lg font-semibold text-ink">WhatsApp</h2>
      <p className="mt-1 text-sm text-muted">Conecta el número de tu empresa para recibir y responder mensajes desde BeeCRM.</p>

      {channels.isPending && <p className="mt-4 text-muted">Cargando…</p>}
      {channels.isError && <div className="mt-4"><Alert>No pudimos cargar los números conectados.</Alert></div>}
      <ul className="mt-4 flex flex-col gap-3">
        {channels.data?.map((c) => (
          <li key={c.id} className="rounded-xl border border-line bg-surface p-4">
            <p className="font-medium text-ink">{c.verifiedName ?? c.displayPhone ?? c.phoneNumberId}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              <dt className="text-muted">Número</dt><dd className="text-ink">{c.displayPhone ?? 'Sin dato'}</dd>
              <dt className="text-muted">Estado</dt><dd className={c.status === 'connected' ? 'text-success' : 'text-danger'}>{c.status === 'connected' ? 'Conectado' : 'Debe reconectarse'}</dd>
              <dt className="text-muted">Verificación del nombre</dt><dd className="text-ink">{c.nameStatus ?? 'Sin dato'}</dd>
              <dt className="text-muted">Calidad</dt><dd className="text-ink">{QUALITY[c.qualityRating ?? 'UNKNOWN'] ?? c.qualityRating}</dd>
            </dl>
            <button onClick={() => refresh.mutate(c.id)} className="mt-2 inline-flex min-h-11 items-center text-sm text-muted underline">
              {refresh.isPending ? 'Actualizando…' : 'Actualizar estado'}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-4">
        {META_APP_ID && META_CONFIG_ID ? (
          <EmbeddedSignupButton onResult={(r) => connect.mutate(r)} loading={connect.isPending} />
        ) : (
          <LocalConnectForm onSubmit={(r) => connect.mutate(r)} loading={connect.isPending} />
        )}
      </div>
      {connect.isError && <div className="mt-3"><Alert>{connect.error instanceof ApiError && connect.error.status !== 403 ? connect.error.message : 'Solo el propietario puede conectar números.'}</Alert></div>}
      {connect.isSuccess && <div className="mt-3"><Alert tone="success">Número conectado.</Alert></div>}
    </section>
  );
}

/**
 * Embedded Signup de Meta: el popup devuelve un `code` (en el callback) y los ids de WABA y número
 * (por postMessage, evento WA_EMBEDDED_SIGNUP). Requiere VITE_META_APP_ID y VITE_META_CONFIG_ID.
 * Validar este flujo con la app real de Meta antes del piloto.
 */
function EmbeddedSignupButton({ onResult, loading }: { onResult: (r: { code: string; wabaId: string; phoneNumberId: string }) => void; loading: boolean }) {
  const [error, setError] = useState<string>();

  async function start() {
    setError(undefined);
    await loadSdk();
    let ids: { wabaId: string; phoneNumberId: string } | undefined;
    const onMessage = (event: MessageEvent) => {
      if (!/^https:\/\/([\w-]+\.)?facebook\.com$/.test(event.origin)) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type === 'WA_EMBEDDED_SIGNUP' && data.event === 'FINISH') ids = { wabaId: data.data.waba_id, phoneNumberId: data.data.phone_number_id };
      } catch { /* mensajes de otros widgets de Facebook */ }
    };
    window.addEventListener('message', onMessage);
    window.FB!.login((response) => {
      window.removeEventListener('message', onMessage);
      const code = response.authResponse?.code;
      if (code && ids) onResult({ code, ...ids });
      else setError('No se completó la conexión con Meta. Intenta de nuevo.');
    }, { config_id: META_CONFIG_ID, response_type: 'code', override_default_response_type: true, extras: { sessionInfoVersion: '3' } });
  }

  return (
    <>
      <Button onClick={start} loading={loading}>Conectar número de WhatsApp</Button>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </>
  );
}

function loadSdk(): Promise<void> {
  if (window.FB) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/es_LA/sdk.js';
    script.async = true;
    script.onload = () => {
      window.FB!.init({ appId: META_APP_ID, autoLogAppEvents: true, xfbml: false, version: 'v23.0' });
      resolve();
    };
    script.onerror = () => reject(new Error('No se pudo cargar el SDK de Meta'));
    document.body.appendChild(script);
  });
}

/** Desarrollo sin cuenta de Meta (API con WHATSAPP_API=local): conecta un número simulado. */
function LocalConnectForm({ onSubmit, loading }: { onSubmit: (r: { code: string; wabaId: string; phoneNumberId: string }) => void; loading: boolean }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const phoneNumberId = String(new FormData(event.currentTarget).get('phoneNumberId'));
    onSubmit({ code: 'local', wabaId: 'WABA-LOCAL', phoneNumberId });
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-dashed border-line p-4">
      <p className="text-sm text-muted">
        Modo desarrollo: falta configurar la app de Meta. Conecta un número simulado y envía mensajes de prueba con{' '}
        <code className="rounded bg-canvas px-1">pnpm --filter @beecrm/api wa:simulate</code>.
      </p>
      <Field label="Id de número simulado" name="phoneNumberId" defaultValue="PN-local" required pattern="[A-Za-z0-9_-]+" />
      <div><Button type="submit" loading={loading}>Conectar número simulado</Button></div>
    </form>
  );
}
