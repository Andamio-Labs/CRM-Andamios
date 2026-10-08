import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { useRegion } from '../../shared/i18n/use-region';
import { Alert, Button } from '../../shared/ui/form';

const PURPOSES = { sales: 'Gestión comercial', customer_service: 'Atención al cliente', marketing: 'Publicidad y promociones', billing: 'Facturación' } as const;
const BASES = { consent: 'Autorización del titular', contract: 'Relación contractual', legal_obligation: 'Obligación legal', public_data: 'Dato público' } as const;
const CHANNELS = { whatsapp: 'WhatsApp', web_form: 'Formulario web', phone: 'Teléfono', email: 'Correo', in_person: 'En persona', import: 'Importación' } as const;

type Purpose = keyof typeof PURPOSES;
interface Consent { id: number; legalBasis: keyof typeof BASES; purposes: Purpose[]; granted: boolean; channel: keyof typeof CHANNELS; evidence: string | null; recordedAt: string }
interface Consents { current: Partial<Record<Purpose, Consent>>; history: Consent[] }

const selectClass = 'min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink';

/** E13-S02 — Base legal, finalidad y fecha del consentimiento del contacto. */
export function ContactConsents({ contactId }: { contactId: string }) {
  const { date, time } = useRegion();
  const queryClient = useQueryClient();
  const [showHistory, setShowHistory] = useState(false);
  const consents = useQuery({ queryKey: ['consents', contactId], queryFn: () => api<Consents>(`/api/v1/contacts/${contactId}/consents`) });
  const record = useMutation({
    mutationFn: (body: object) => api(`/api/v1/contacts/${contactId}/consents`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['consents', contactId] }),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    record.mutate({
      legalBasis: form.get('legalBasis'),
      purposes: form.getAll('purposes'),
      granted: form.get('granted') === 'true',
      channel: form.get('channel'),
      evidence: String(form.get('evidence') ?? '').trim() || null,
    });
  }

  if (consents.isPending) return <p className="text-sm text-muted">Cargando consentimiento…</p>;
  if (consents.isError) return <Alert>No pudimos cargar el consentimiento.</Alert>;
  const { current, history } = consents.data;

  return (
    <section aria-label="Consentimiento" className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Consentimiento por finalidad</h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {(Object.keys(PURPOSES) as Purpose[]).map((purpose) => {
          const c = current[purpose];
          return (
            <li key={purpose} className="rounded-lg border border-line px-3 py-2 text-sm">
              <p className="font-semibold text-ink">{PURPOSES[purpose]}</p>
              <p className="text-xs text-muted">
                {c ? `${c.granted ? 'Autorizado' : 'Revocado'} · ${BASES[c.legalBasis]} · ${CHANNELS[c.channel]} · ${date(c.recordedAt)}` : 'Sin registro'}
              </p>
            </li>
          );
        })}
      </ul>

      <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg border border-line p-3">
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="mb-1 text-xs text-muted">Finalidades</legend>
          {(Object.keys(PURPOSES) as Purpose[]).map((purpose) => (
            <label key={purpose} className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="purposes" value={purpose} /> {PURPOSES[purpose]}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <select name="granted" aria-label="Decisión" className={selectClass}><option value="true">Autoriza</option><option value="false">Revoca</option></select>
          <select name="legalBasis" aria-label="Base legal" className={selectClass}>{Object.entries(BASES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select name="channel" aria-label="Canal" className={selectClass}>{Object.entries(CHANNELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>
        <input name="evidence" maxLength={1000} placeholder="Evidencia (opcional): dónde y cómo lo autorizó" className={`${selectClass} w-full`} />
        {record.isError && <Alert>{record.error instanceof ApiError && record.error.status === 400 ? 'Elegí al menos una finalidad.' : 'No pudimos guardar el registro.'}</Alert>}
        <Button type="submit" loading={record.isPending} className="self-start">Registrar</Button>
      </form>

      {history.length > 0 && (
        <div>
          <button onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory} className="inline-flex min-h-11 items-center text-sm text-ink underline">
            {showHistory ? 'Ocultar historial' : `Ver historial (${history.length})`}
          </button>
          {showHistory && (
            <ol className="flex flex-col gap-2 border-l-2 border-line pl-4">
              {history.map((h) => (
                <li key={h.id} className="text-sm">
                  <p className="text-xs text-muted">{date(h.recordedAt)} {time(h.recordedAt)} · {CHANNELS[h.channel]} · {BASES[h.legalBasis]}</p>
                  <p className="text-ink">{h.granted ? 'Autorizó' : 'Revocó'}: {h.purposes.map((p) => PURPOSES[p]).join(', ')}</p>
                  {h.evidence && <p className="text-xs text-muted">{h.evidence}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
