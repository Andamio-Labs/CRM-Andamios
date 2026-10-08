import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { Button } from '../../shared/ui/form';

interface Step { key: 'whatsapp' | 'pipeline' | 'import' | 'team'; label: string; link: string; done: boolean }
interface Onboarding { steps: Step[]; progress: number; completed: boolean; dismissed: boolean }
interface Template { id: string; label: string; stages: string[] }

/** E14-S03 — Guía de primeros pasos en el inicio, con su avance. Se oculta al completar o al descartarla. */
export function OnboardingChecklist() {
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const onboarding = useQuery({ queryKey: ['onboarding'], queryFn: () => api<Onboarding>('/api/v1/onboarding') });
  const templates = useQuery({ queryKey: ['pipeline-templates'], queryFn: () => api<Template[]>('/api/v1/onboarding/pipeline-templates'), enabled: picking });
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['onboarding'] }), queryClient.invalidateQueries({ queryKey: ['pipelines'] })]);
  const apply = useMutation({
    mutationFn: (template: string) => api('/api/v1/onboarding/pipeline-template', { method: 'POST', body: JSON.stringify({ template }) }),
    onSuccess: () => { setPicking(false); return refresh(); },
  });
  const dismiss = useMutation({ mutationFn: () => api('/api/v1/onboarding/dismiss', { method: 'POST' }), onSuccess: refresh });

  const o = onboarding.data;
  if (!o || o.completed || o.dismissed) return null;
  const canManage = !(dismiss.error instanceof ApiError && dismiss.error.status === 403);

  return (
    <section aria-labelledby="onboarding-title" className="mb-4 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="onboarding-title" className="font-semibold text-ink">Primeros pasos</h2>
        <span className="text-sm text-muted">{o.progress} %</span>
      </div>
      <div role="progressbar" aria-valuenow={o.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Avance" className="mt-2 h-2 overflow-hidden rounded-full bg-canvas">
        <div className="h-full bg-honey transition-[width]" style={{ width: `${o.progress}%` }} />
      </div>
      <ol className="mt-3 flex flex-col gap-1">
        {o.steps.map((s) => (
          <li key={s.key} className="flex min-h-11 items-center gap-3 text-sm">
            <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-full text-xs ${s.done ? 'bg-honey text-ink' : 'border border-line text-muted'}`}>{s.done ? '✓' : ''}</span>
            <span className={s.done ? 'text-muted line-through' : 'text-ink'}>{s.label}</span>
            {!s.done && (s.key === 'pipeline'
              ? <button onClick={() => setPicking(true)} className="ml-auto inline-flex min-h-11 items-center text-ink underline">Elegir</button>
              : <Link to={s.link} className="ml-auto inline-flex min-h-11 items-center text-ink underline">Ir</Link>)}
            <span className="sr-only">{s.done ? 'hecho' : 'pendiente'}</span>
          </li>
        ))}
      </ol>
      {picking && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {templates.data?.map((tpl) => (
            <button key={tpl.id} onClick={() => apply.mutate(tpl.id)} disabled={apply.isPending}
              className="flex flex-col items-start gap-1 rounded-lg border border-line p-3 text-left hover:border-ink">
              <span className="text-sm font-semibold text-ink">{tpl.label}</span>
              <span className="text-xs text-muted">{tpl.stages.join(' → ')}</span>
            </button>
          ))}
          {apply.isError && <p className="text-sm text-danger">{apply.error instanceof ApiError && apply.error.status === 403 ? 'Solo propietarios y administradores eligen el embudo.' : 'No se pudo aplicar la plantilla.'}</p>}
        </div>
      )}
      {canManage && <Button onClick={() => dismiss.mutate()} className="mt-3 bg-transparent text-muted underline hover:brightness-100">Ocultar guía</Button>}
    </section>
  );
}
