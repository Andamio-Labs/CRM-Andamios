import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { useRegion } from '../../shared/i18n/use-region';
import { Alert } from '../../shared/ui/form';
import { BotIcon, PlusIcon, TrashIcon, TrophyIcon } from '../../shared/ui/icons';
import { Badge, inputClass, labelClass, primaryButton, secondaryButton } from '../../shared/ui/section';
import { useTeamPresence } from '../team/presence';
import { describeRobot, type Robot, type RobotAction, type RobotTrigger } from './robot-text';

interface Stage { id: string; name: string; color: string }
interface RobotRun { id: number; robotId: string; dealTitle: string; status: 'ok' | 'skipped' | 'error'; detail: string | null; createdAt: string }

const RUN_TONE = { ok: 'success', skipped: 'neutral', error: 'danger' } as const;
const RUN_LABEL = { ok: 'Hecho', skipped: 'Omitido', error: 'Error' } as const;

/**
 * E07-S04 — Robots por etapa ("cuando → si → hacer"), dentro de "Configurar embudo".
 * Solo propietario y admins: para un vendedor la API responde 403 y el panel no aparece.
 */
export function RobotsPanel({ pipelineId, stages }: { pipelineId: string; stages: Stage[] }) {
  const queryClient = useQueryClient();
  const { money, date, time } = useRegion();
  const team = useTeamPresence();
  const [adding, setAdding] = useState<string | 'won'>();
  const [showRuns, setShowRuns] = useState(false);
  const key = ['robots', pipelineId];
  const robots = useQuery({ queryKey: key, queryFn: () => api<Robot[]>(`/api/v1/automation/robots?pipelineId=${pipelineId}`), retry: false });
  const runs = useQuery({ queryKey: ['robot-runs'], queryFn: () => api<RobotRun[]>('/api/v1/automation/robots/runs'), enabled: showRuns });
  const toggle = useMutation({
    mutationFn: (robot: Robot) => api(`/api/v1/automation/robots/${robot.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !robot.enabled }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/v1/automation/robots/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  if (robots.error instanceof ApiError && robots.error.status === 403) return null;
  const names = {
    stage: (id: string) => stages.find((s) => s.id === id)?.name ?? 'otra etapa',
    member: (id: string) => team.data?.find((p) => p.userId === id)?.name ?? 'alguien del equipo',
    money: (value: number) => money(value),
  };
  const groups: { id: string | 'won'; title: string; color?: string }[] = [
    ...stages.map((s) => ({ id: s.id, title: s.name, color: s.color })),
    { id: 'won', title: 'Al ganar un negocio' },
  ];

  return (
    <section aria-labelledby="robots-title" className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-honey-soft text-ink"><BotIcon size={16} /></span>
          <div>
            <h3 id="robots-title" className="text-sm font-semibold text-ink">Robots por etapa</h3>
            <p className="text-xs text-muted">Cuando pasa algo con un negocio, el robot avisa, crea una tarea, asigna o lo mueve de etapa. Cada robot actúa una sola vez por ocasión.</p>
          </div>
        </div>
        <button type="button" onClick={() => setShowRuns((v) => !v)} className={`${secondaryButton} min-h-8 px-3`}>{showRuns ? 'Ocultar registro' : 'Ver registro'}</button>
      </div>
      {robots.isError && !(robots.error instanceof ApiError && robots.error.status === 403) && <div className="mt-3"><Alert>No pudimos cargar los robots.</Alert></div>}

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {groups.map((group) => {
          const list = robots.data?.filter((r) => (group.id === 'won' ? r.stageId === null : r.stageId === group.id)) ?? [];
          return (
            <div key={group.id} className="rounded-xl border border-line bg-canvas p-3">
              <div className="flex items-center gap-2">
                {group.id === 'won' ? <TrophyIcon size={14} className="text-success" /> : <span className="size-2 rounded-full" style={{ background: group.color }} />}
                <p className="flex-1 text-xs font-semibold text-ink">{group.title}</p>
                <button type="button" onClick={() => setAdding(group.id)} aria-label={`Agregar robot en ${group.title}`} className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface hover:text-ink"><PlusIcon size={14} /></button>
              </div>
              {!list.length && adding !== group.id && <p className="mt-1.5 text-[11px] text-muted">Sin robots.</p>}
              <ul className="mt-1.5 flex flex-col gap-1">
                {list.map((robot) => (
                  <li key={robot.id} className={`flex items-center gap-2 rounded-lg bg-surface px-2.5 py-1.5 text-xs ${robot.enabled ? 'text-ink' : 'text-muted line-through'}`}>
                    <span className="flex-1">{describeRobot(robot, names)}</span>
                    <label className="flex items-center gap-1 text-[10px] text-muted no-underline" title={robot.enabled ? 'Pausar' : 'Activar'}>
                      <input type="checkbox" checked={robot.enabled} onChange={() => toggle.mutate(robot)} className="size-3.5 accent-honey" aria-label={robot.enabled ? 'Pausar robot' : 'Activar robot'} />
                    </label>
                    <button type="button" onClick={() => confirm('¿Borrar este robot?') && remove.mutate(robot.id)} aria-label="Borrar robot" className="text-muted hover:text-danger"><TrashIcon size={13} /></button>
                  </li>
                ))}
              </ul>
              {adding === group.id && (
                <RobotForm
                  pipelineId={pipelineId}
                  stageId={group.id === 'won' ? null : group.id}
                  stages={stages}
                  onDone={() => { setAdding(undefined); void queryClient.invalidateQueries({ queryKey: key }); }}
                  onCancel={() => setAdding(undefined)}
                />
              )}
            </div>
          );
        })}
      </div>

      {showRuns && (
        <div className="mt-3 rounded-xl border border-line">
          {runs.isPending && <p className="p-3 text-xs text-muted">Cargando…</p>}
          {runs.data && !runs.data.length && <p className="p-3 text-xs text-muted">Los robots todavía no han actuado.</p>}
          <ul className="divide-y divide-line">
            {runs.data?.slice(0, 15).map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <Badge tone={RUN_TONE[run.status]}>{RUN_LABEL[run.status]}</Badge>
                <span className="font-medium text-ink">{run.dealTitle}</span>
                <span className="text-muted">{run.detail}</span>
                <span className="ml-auto text-muted">{date(run.createdAt)} {time(run.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

type TriggerType = RobotTrigger['type'];
type ActionType = RobotAction['type'];

function RobotForm({ pipelineId, stageId, stages, onDone, onCancel }: { pipelineId: string; stageId: string | null; stages: Stage[]; onDone: () => void; onCancel: () => void }) {
  const team = useTeamPresence();
  const won = stageId === null;
  const [trigger, setTrigger] = useState<TriggerType>(won ? 'won' : 'enter');
  const [action, setAction] = useState<ActionType>('notify');
  const create = useMutation({
    mutationFn: (body: object) => api('/api/v1/automation/robots', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: onDone,
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get('amount'));
    const minValue = String(form.get('minValue') ?? '').trim();
    const triggerBody = trigger === 'stale' ? { type: 'stale', days: amount } : trigger === 'no_reply' ? { type: 'no_reply', hours: amount } : { type: trigger };
    const actionBody = action === 'notify' ? { type: 'notify', to: String(form.get('to')) }
      : action === 'task' ? { type: 'task', title: String(form.get('title')).trim(), dueHours: Number(form.get('dueHours')) }
        : action === 'assign' ? { type: 'assign', userId: String(form.get('userId')) }
          : { type: 'move', stageId: String(form.get('target')) };
    create.mutate({
      pipelineId,
      stageId,
      trigger: triggerBody,
      condition: { ...(minValue ? { minValue: Number(minValue) } : {}), ...(form.get('unassigned') === 'on' ? { unassigned: true } : {}) },
      action: actionBody,
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-2 grid gap-2 rounded-lg border border-honey/40 bg-surface p-2.5 text-xs">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={labelClass}>
          Cuando
          {won ? <span className="flex h-10 items-center text-sm font-normal text-ink">Se gana el negocio</span> : (
            <select value={trigger} onChange={(e) => setTrigger(e.target.value as TriggerType)} className={inputClass}>
              <option value="enter">Entra a esta etapa</option>
              <option value="stale">Lleva X días en la etapa</option>
              <option value="no_reply">El cliente no responde en X horas</option>
            </select>
          )}
        </label>
        {(trigger === 'stale' || trigger === 'no_reply') && (
          <label className={labelClass}>
            {trigger === 'stale' ? 'Días' : 'Horas'}
            <input name="amount" type="number" required min={1} max={trigger === 'stale' ? 90 : 720} defaultValue={trigger === 'stale' ? 3 : 24} className={inputClass} />
          </label>
        )}
      </div>
      <details className="rounded-md bg-canvas px-2 py-1.5">
        <summary className="cursor-pointer text-[11px] font-semibold text-muted">Solo si… (opcional)</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className={labelClass}>
            Vale al menos
            <input name="minValue" type="number" min={0} placeholder="Cualquier valor" className={inputClass} />
          </label>
          <label className="flex items-center gap-2 pt-5 text-xs text-ink">
            <input name="unassigned" type="checkbox" className="size-4 accent-honey" /> No tiene responsable
          </label>
        </div>
      </details>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={labelClass}>
          Hacer
          <select value={action} onChange={(e) => setAction(e.target.value as ActionType)} className={inputClass}>
            <option value="notify">Avisar</option>
            <option value="task">Crear una tarea</option>
            <option value="assign">Asignar responsable</option>
            {!won && <option value="move">Mover a otra etapa</option>}
          </select>
        </label>
        {action === 'notify' && (
          <label className={labelClass}>
            A quién
            <select name="to" defaultValue="owner" className={inputClass}>
              <option value="owner">Al responsable</option>
              <option value="admins">A propietario y admins</option>
            </select>
          </label>
        )}
        {action === 'assign' && (
          <label className={labelClass}>
            Responsable
            <select name="userId" required className={inputClass}>
              {team.data?.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
            </select>
          </label>
        )}
        {action === 'move' && (
          <label className={labelClass}>
            Etapa destino
            <select name="target" required className={inputClass}>
              {stages.filter((s) => s.id !== stageId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {action === 'task' && (
        <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
          <label className={labelClass}>
            Tarea
            <input name="title" required maxLength={200} placeholder="Llamar para seguimiento" className={inputClass} />
          </label>
          <label className={labelClass}>
            Vence en (h)
            <input name="dueHours" type="number" min={0} max={720} defaultValue={24} className={inputClass} />
          </label>
        </div>
      )}
      {create.isError && <Alert>{create.error instanceof ApiError ? create.error.message : 'No pudimos crear el robot.'}</Alert>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={`${secondaryButton} min-h-8 px-3`}>Cancelar</button>
        <button type="submit" disabled={create.isPending} className={`${primaryButton} min-h-8 px-3`}>Crear robot</button>
      </div>
    </form>
  );
}
