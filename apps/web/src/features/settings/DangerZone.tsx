import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { Alert, Button, Field } from '../../shared/ui/form';

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
    <section className="mt-10 rounded-xl border border-danger/40 p-4" aria-labelledby="danger-title">
      <h2 id="danger-title" className="text-lg font-semibold text-danger">Eliminar la empresa</h2>
      <p className="mt-1 text-sm text-ink">Borra todos los datos, archivos y usuarios de la empresa. <strong>No se puede deshacer.</strong> Si querés conservar algo, exportalo antes.</p>
      {step === 'idle' ? (
        <Button onClick={() => request.mutate()} loading={request.isPending} className="mt-3">Enviarme el código de eliminación</Button>
      ) : (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-muted">Te enviamos un código de 6 dígitos al correo. Vence en 30 minutos.</p>
          <Field label="Código" name="code" inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" />
          <Field label="Nombre exacto de la empresa" name="companyName" required />
          {remove.isError && <Alert>{remove.error instanceof ApiError ? remove.error.message : 'No pudimos eliminar la empresa.'}</Alert>}
          <Button type="submit" loading={remove.isPending} className="self-start">Eliminar todo definitivamente</Button>
        </form>
      )}
      {request.isError && <div className="mt-2"><Alert>No pudimos enviar el código.</Alert></div>}
    </section>
  );
}
