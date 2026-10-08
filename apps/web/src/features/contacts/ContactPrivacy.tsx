import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { Alert, Button } from '../../shared/ui/form';

const TYPES = { access: 'Consulta', export: 'Copia de sus datos', update: 'Corrección', erase: 'Supresión' } as const;
const CHANNELS = { email: 'Correo', whatsapp: 'WhatsApp', phone: 'Teléfono', web_form: 'Formulario web', in_person: 'En persona' } as const;
const selectClass = 'min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink';

/** E13-S03 — Derechos del titular desde la ficha: registrar la solicitud, exportar y suprimir. Propietario y admin. */
export function ContactPrivacy({ contactId, contactName }: { contactId: string; contactName: string }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const request = useMutation({
    mutationFn: (body: object) => api('/api/v1/privacy/requests', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['privacy-requests'] }),
  });
  const erase = useMutation({
    mutationFn: () => api(`/api/v1/contacts/${contactId}/erase`, { method: 'POST', body: JSON.stringify({ confirm: true }) }),
    onSuccess: () => { setConfirming(false); return queryClient.invalidateQueries(); },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    request.mutate({ contactId, type: form.get('type'), channel: form.get('channel'), details: String(form.get('details') ?? '').trim() || null });
  }

  const forbidden = (e: unknown) => e instanceof ApiError && e.status === 403;
  if (forbidden(request.error) || forbidden(erase.error)) return null;

  return (
    <section aria-label="Derechos del titular" className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Derechos del titular</h3>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <select name="type" aria-label="Tipo de solicitud" className={selectClass}>{Object.entries(TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select name="channel" aria-label="Canal" className={selectClass}>{Object.entries(CHANNELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <input name="details" maxLength={2000} placeholder="Detalle (opcional)" aria-label="Detalle" className={`${selectClass} min-w-0 flex-1`} />
        <Button type="submit" loading={request.isPending}>Registrar solicitud</Button>
      </form>
      {request.isSuccess && <Alert tone="success">Solicitud registrada con su plazo legal. La ves en Configuración.</Alert>}
      <div className="flex flex-wrap gap-3">
        <a href={`/api/v1/contacts/${contactId}/personal-data`} download className="inline-flex min-h-11 items-center text-sm text-ink underline">Descargar sus datos (JSON)</a>
        <button onClick={() => setConfirming(true)} className="inline-flex min-h-11 items-center text-sm text-danger underline">Suprimir sus datos</button>
      </div>
      {confirming && (
        <div role="alertdialog" aria-label="Confirmar supresión" className="flex flex-col gap-2 rounded-lg border border-danger/40 p-3 text-sm">
          <p className="text-ink">Se borran conversaciones, mensajes, archivos y tareas, y el contacto queda anónimo. Los negocios se conservan sin datos personales. <strong>No se puede deshacer.</strong></p>
          <label className="flex flex-col gap-1 text-ink">Escribe <strong>{contactName}</strong> para confirmar
            <input value={typed} onChange={(e) => setTyped(e.target.value)} className={selectClass} />
          </label>
          {erase.isError && <Alert>No pudimos suprimir los datos.</Alert>}
          <div className="flex gap-2">
            <Button onClick={() => erase.mutate()} disabled={typed !== contactName} loading={erase.isPending}>Suprimir definitivamente</Button>
            <button onClick={() => { setConfirming(false); setTyped(''); }} className="inline-flex min-h-11 items-center px-3 text-sm text-ink underline">Cancelar</button>
          </div>
        </div>
      )}
    </section>
  );
}
