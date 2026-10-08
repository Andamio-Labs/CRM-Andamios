import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { linkTarget } from '../../shared/link-target';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { IconTile, linkButton, Meter } from '../../shared/ui/section';

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
    <section aria-labelledby="onboarding-title" className="mb-4 rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <IconTile>✓</IconTile>
        <div className="min-w-0 flex-1">
          <h2 id="onboarding-title" className="text-sm font-semibold text-ink">Deja lista tu cuenta</h2>
          <p className="text-xs text-muted">Cuatro pasos y tu equipo empieza a vender desde BeeCRM. Cada uno se marca solo al completarlo.</p>
        </div>
        <span className="text-xs font-semibold text-ink">{o.progress} %</span>
      </div>
      <div className="mt-3"><Meter percent={o.progress} label="Avance de la configuración inicial" /></div>
      <ol className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-4">
        {o.steps.map((s, index) => {
          const content = (
            <>
              <span aria-hidden className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] ${s.done ? 'bg-honey font-semibold text-ink' : 'border border-line text-muted'}`}>{s.done ? '✓' : index + 1}</span>
              <span className={`text-xs font-medium ${s.done ? 'text-muted line-through' : 'text-ink'}`}>{s.label}</span>
              <span className="sr-only">{s.done ? '(hecho)' : '(pendiente)'}</span>
              {!s.done && <span aria-hidden className="ml-auto text-muted">›</span>}
            </>
          );
          const box = 'flex min-h-14 w-full items-center gap-2 rounded-lg border px-3 text-left';
          return (
            <li key={s.key}>
              {s.done ? <div className={`${box} border-line bg-canvas`}>{content}</div>
                : s.key === 'pipeline' ? <button onClick={() => setPicking(true)} className={`${box} border-line hover:border-honey`}>{content}</button>
                  : <Link {...(linkTarget(s.link) as { to: '/' })} className={`${box} border-line hover:border-honey`}>{content}</Link>}
            </li>
          );
        })}
      </ol>
      {picking && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {templates.data?.map((tpl) => (
            <button key={tpl.id} onClick={() => apply.mutate(tpl.id)} disabled={apply.isPending}
              className="flex flex-col items-start gap-1 rounded-lg border border-line p-3 text-left hover:border-honey hover:bg-honey-soft/40">
              <span className="text-xs font-semibold text-ink">{tpl.label}</span>
              <span className="text-[11px] text-muted">{tpl.stages.join(' → ')}</span>
            </button>
          ))}
          {apply.isError && <p className="text-xs text-danger">{apply.error instanceof ApiError && apply.error.status === 403 ? 'Solo propietarios y administradores eligen el embudo.' : 'No se pudo aplicar la plantilla.'}</p>}
        </div>
      )}
      {canManage && <button onClick={() => dismiss.mutate()} className={`${linkButton} mt-2 text-muted`}>Ocultar guía</button>}
    </section>
  );
}
