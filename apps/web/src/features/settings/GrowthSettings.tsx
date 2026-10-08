import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { SettingsSection } from '../../shared/ui/section';
import { Alert, Button, Field } from '../../shared/ui/form';

type RuleKey = 'new_lead' | 'no_reply' | 'stage_template' | 'won_notify';
interface Rule { rule: RuleKey; label: string; enabled: boolean; config: Record<string, unknown> }
interface Pipeline { id: string; name: string; stages: { id: string; name: string }[] }
interface Template { id: string; name: string; status: string }
interface WaLink { id: string; code: string; url: string; message: string; utmSource: string | null; utmCampaign: string | null; clicks: number }
interface Channel { id: string; verifiedName: string | null; phoneNumberId: string }

const errorText = (e: unknown) => (e instanceof ApiError ? (e.status === 403 ? 'Solo propietarios y administradores pueden hacer esto.' : e.message) : 'No se pudo guardar.');

/** E07-S01 reglas + E09-S01 enlaces. */
export function GrowthSettings() {
  return (
    <>
      <AutomationRules />
      <WaLinks />
    </>
  );
}

function AutomationRules() {
  const queryClient = useQueryClient();
  const rules = useQuery({ queryKey: ['automation-rules'], queryFn: () => api<Rule[]>('/api/v1/automation/rules'), retry: false });
  const pipelines = useQuery({ queryKey: ['pipelines'], queryFn: () => api<Pipeline[]>('/api/v1/pipelines') });
  const templates = useQuery({ queryKey: ['wa-templates'], queryFn: () => api<Template[]>('/api/v1/whatsapp/templates') });
  const save = useMutation({
    mutationFn: ({ rule, enabled, config }: { rule: RuleKey; enabled: boolean; config: object }) =>
      api(`/api/v1/automation/rules/${rule}`, { method: 'PUT', body: JSON.stringify({ enabled, config }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automation-rules'] }),
  });

  if (rules.isError) return null; // el vendedor no gestiona reglas: la sección no se muestra
  const approved = templates.data?.filter((t) => t.status === 'APPROVED') ?? [];
  const stages = pipelines.data?.flatMap((p) => p.stages.map((s) => ({ ...s, label: `${p.name}: ${s.name}` }))) ?? [];

  return (
    <SettingsSection icon="ϟ" title="Automatizaciones" description={<>Reglas listas para usar. Cada ejecución queda registrada.</>}>
      <ul className="mt-3 flex flex-col gap-3">
        {rules.data?.map((r) => (
          <li key={r.rule} className="rounded-lg border border-line p-3">
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" checked={r.enabled} onChange={(e) => save.mutate({ rule: r.rule, enabled: e.target.checked, config: r.config })} className="size-5 accent-honey" />
              <span className="font-medium text-ink">{r.label}</span>
            </label>
            {r.rule === 'new_lead' && (
              <NumberSetting label="Vence la tarea en (minutos)" value={Number(r.config.taskDueMinutes ?? 30)} onSave={(v) => save.mutate({ rule: r.rule, enabled: r.enabled, config: { ...r.config, taskDueMinutes: v } })} />
            )}
            {r.rule === 'no_reply' && (
              <NumberSetting label="Avisar después de (horas)" value={Number(r.config.hours ?? 2)} onSave={(v) => save.mutate({ rule: r.rule, enabled: r.enabled, config: { hours: v } })} />
            )}
            {r.rule === 'stage_template' && (
              <div className="mt-2 flex flex-col gap-2">
                {stages.map((s) => {
                  const current = (r.config.stages as Record<string, string> | undefined)?.[s.id] ?? '';
                  return (
                    <label key={s.id} className="flex flex-wrap items-center gap-2 text-sm text-ink">
                      <span className="w-48 truncate">{s.label}</span>
                      <select
                        value={current}
                        onChange={(e) => {
                          const next = { ...(r.config.stages as Record<string, string> | undefined) };
                          if (e.target.value) next[s.id] = e.target.value; else delete next[s.id];
                          save.mutate({ rule: r.rule, enabled: r.enabled, config: { stages: next } });
                        }}
                        className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2"
                      >
                        <option value="">Sin plantilla</option>
                        {approved.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </label>
                  );
                })}
                {!approved.length && <p className="text-sm text-muted">Necesitas plantillas aprobadas para usar esta regla.</p>}
              </div>
            )}
          </li>
        ))}
      </ul>
      {save.isError && <div className="mt-3"><Alert>{errorText(save.error)}</Alert></div>}
    </SettingsSection>
  );
}

function NumberSetting({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  return (
    <label className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink">
      {label}
      <input type="number" min={0} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => Number(draft) !== value && onSave(Number(draft))} className="h-11 w-24 rounded-lg border border-line bg-surface px-2" />
    </label>
  );
}

function WaLinks() {
  const queryClient = useQueryClient();
  const links = useQuery({ queryKey: ['wa-links'], queryFn: () => api<WaLink[]>('/api/v1/wa-links') });
  const channels = useQuery({ queryKey: ['wa-channels'], queryFn: () => api<Channel[]>('/api/v1/whatsapp/channels') });
  const create = useMutation({
    mutationFn: (body: object) => api('/api/v1/wa-links', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wa-links'] }),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const opt = (k: string) => String(form.get(k) ?? '').trim() || undefined;
    create.mutate({ channelId: String(form.get('channelId')), message: String(form.get('message')), utmSource: opt('utmSource'), utmMedium: opt('utmMedium'), utmCampaign: opt('utmCampaign') }, { onSuccess: () => formEl.reset() });
  }

  return (
    <SettingsSection icon="↗" title="Enlaces a WhatsApp para anuncios" description={<>Úsalos en anuncios, redes o tu web: el cliente llega con el mensaje escrito y el origen y la campaña quedan en su ficha.</>}>
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface empty:hidden">
        {links.data?.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink">{l.url}</p>
              <p className="truncate text-sm text-muted">{l.message} · {[l.utmSource, l.utmCampaign].filter(Boolean).join(' / ') || 'sin UTM'}</p>
            </div>
            <span className="text-sm text-muted">{l.clicks} clics</span>
            <button onClick={() => navigator.clipboard?.writeText(l.url)} className="min-h-11 px-2 text-sm text-ink underline">Copiar</button>
          </li>
        ))}
      </ul>
      {Boolean(channels.data?.length) && (
        <form onSubmit={onSubmit} className="mt-4 grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Número
            <select name="channelId" className="h-11 rounded-lg border border-line bg-surface px-3">
              {channels.data!.map((c) => <option key={c.id} value={c.id}>{c.verifiedName ?? c.phoneNumberId}</option>)}
            </select>
          </label>
          <Field label="Mensaje que escribe el cliente" name="message" required defaultValue="Hola, quiero más información" />
          <Field label="utm_source" name="utmSource" placeholder="facebook" />
          <Field label="utm_campaign" name="utmCampaign" placeholder="lanzamiento-octubre" />
          <Field label="utm_medium" name="utmMedium" placeholder="cpc" />
          {create.isError && <div className="sm:col-span-2"><Alert>{errorText(create.error)}</Alert></div>}
          <div className="sm:col-span-2"><Button type="submit" loading={create.isPending}>Crear enlace</Button></div>
        </form>
      )}
    </SettingsSection>
  );
}
