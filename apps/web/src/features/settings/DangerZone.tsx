import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { dangerButton, inputClass, labelClass, secondaryButton, SettingsSection } from '../../shared/ui/section';
import { Alert } from '../../shared/ui/form';

/** E13-S04 — Eliminar la empresa: código por correo + nombre exacto. Solo el propietario. */
export function DangerZone() {
  // billing:manage y tenant:delete son solo del propietario: si ve el plan, puede eliminar.
  const owner = useQuery({ queryKey: ['billing'], queryFn: () => api('/api/v1/billing'), retry: false });
  const [step, setStep] = useState<'idle' | 'code'>('idle');
  const request = useMutation({
    mutationFn: () => api('/api/v1/tenant/deletion-request', { method: 'POST' }),
    onSuccess: () => setStep('code'),
  });
  const remove = useMutation({
    mutationFn: (body: object) => api('/api/v1/tenant', { method: 'DELETE', body: JSON.stringify(body) }),
    onSuccess: () => window.location.assign('/login'),
  });

  if (!owner.isSuccess) return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    remove.mutate({ code: String(form.get('code')).trim(), companyName: String(form.get('companyName')) });
  }

  return (
    <SettingsSection tone="danger" icon="⚠" title="Eliminar la empresa" description={<>Borra todos los datos, archivos y usuarios de la empresa. <strong className="text-ink">No se puede deshacer.</strong> Si quieres conservar algo, expórtalo antes.</>}>
      {step === 'idle' ? (
        <button onClick={() => request.mutate()} disabled={request.isPending} className={secondaryButton}>Enviarme el código de eliminación</button>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <p className="text-xs text-muted">Te enviamos un código de 6 dígitos al correo. Vence en 30 minutos.</p>
          <label className={labelClass}>Código
            <input name="code" inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" className={inputClass} />
          </label>
          <label className={labelClass}>Nombre exacto de la empresa
            <input name="companyName" required className={inputClass} />
          </label>
          {remove.isError && <Alert>{remove.error instanceof ApiError ? remove.error.message : 'No pudimos eliminar la empresa.'}</Alert>}
          <button type="submit" disabled={remove.isPending} className={`${dangerButton} self-start`}>Eliminar todo definitivamente</button>
        </form>
      )}
      {request.isError && <div className="mt-2"><Alert>No pudimos enviar el código.</Alert></div>}
    </SettingsSection>
  );
}
