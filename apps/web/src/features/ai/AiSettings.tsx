import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { Alert } from '../../shared/ui/form';
import {
  Badge, inputClass, labelClass, Meter, primaryButton, secondaryButton, SettingsSection, textareaClass,
} from '../../shared/ui/section';
import { AiLogs } from './AiLogs';
import { KnowledgeBase } from './KnowledgeBase';
import { OUTCOMES, type Outcome, VIOLATIONS } from './ai-format';

export interface Agent {
  name: string;
  tone: 'friendly' | 'formal' | 'neutral';
  language: 'es-CO' | 'es-MX' | 'pt-BR';
  schedule: 'always' | 'business_hours' | 'out_of_hours';
  instructions: string;
  enabled: boolean;
  handoffKeywords: string[];
  qualification: string[];
  blockOnQuota: boolean;
  aiConfigured: boolean;
  knowledgeConfigured: boolean;
  qualificationOptions: { target: string; label: string }[];
}
interface Usage { month: string; used: number; limit: number; percent: number; exhausted: boolean; blockOnQuota: boolean }
interface Preview {
  systemPrompt: string;
  reply: string | null;
  aiConfigured: boolean;
  outcome?: Outcome;
  handoff?: boolean;
  fields?: Record<string, unknown>;
  sources?: { sourceId: string; title: string }[];
  violations?: string[];
  latencyMs?: number;
}

const TONES = { friendly: 'Cercano', formal: 'Formal', neutral: 'Neutral' } as const;
const LANGUAGES = { 'es-CO': 'Español (Colombia)', 'es-MX': 'Español (México)', 'pt-BR': 'Portugués (Brasil)' } as const;
const SCHEDULES = { always: 'Siempre', business_hours: 'Solo en horario laboral', out_of_hours: 'Solo fuera del horario laboral' } as const;

/** E05 — Pestaña "Asistente IA": estado y cuota, comportamiento, traspaso, calificación, conocimiento, simulador y registro. */
export function AiSettings() {
  const queryClient = useQueryClient();
  const agent = useQuery({ queryKey: ['ai-agent'], queryFn: () => api<Agent>('/api/v1/ai/agent'), retry: false });
  const save = useMutation({
    mutationFn: (body: Partial<Agent>) => api<Agent>('/api/v1/ai/agent', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (data) => {
      queryClient.setQueryData(['ai-agent'], data);
      void queryClient.invalidateQueries({ queryKey: ['ai-usage'] });
    },
  });

  if (agent.isError) return <Alert>Solo el propietario y los administradores configuran el asistente.</Alert>;
  if (!agent.data) return <p className="text-xs text-muted">Cargando…</p>;
  const a = agent.data;
  const saveError = save.error instanceof ApiError ? save.error.message : save.isError ? 'No se pudo guardar.' : null;

  return (
    <div className="flex flex-col gap-4">
      <AgentStatus agent={a} saving={save.isPending} onToggle={(enabled) => save.mutate({ enabled })} />
      {saveError && <Alert>{saveError}</Alert>}
      <AgentBehavior key={`${a.name}|${a.instructions}|${a.tone}|${a.language}|${a.schedule}`} agent={a} saving={save.isPending} onSave={(body) => save.mutate(body)} />
      <HandoffSettings key={`${a.handoffKeywords.join()}|${a.blockOnQuota}`} agent={a} saving={save.isPending} onSave={(body) => save.mutate(body)} />
      <QualificationSettings key={a.qualification.join()} agent={a} saving={save.isPending} onSave={(qualification) => save.mutate({ qualification })} />
      <KnowledgeBase knowledgeConfigured={a.knowledgeConfigured} />
      <AgentSimulator aiConfigured={a.aiConfigured} labels={Object.fromEntries(a.qualificationOptions.map((o) => [o.target, o.label]))} />
      <AiLogs />
    </div>
  );
}

function AgentStatus({ agent, saving, onToggle }: { agent: Agent; saving: boolean; onToggle: (enabled: boolean) => void }) {
  const usage = useQuery({ queryKey: ['ai-usage'], queryFn: () => api<Usage>('/api/v1/ai/usage'), retry: false });
  const u = usage.data;
  return (
    <SettingsSection
      icon="✦"
      title={`${agent.name}, tu asistente de WhatsApp`}
      description="Responde con lo que cargues en la base de conocimiento y pasa a una persona cuando no sabe o el cliente lo pide."
      action={
        <label className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${agent.enabled ? 'border-honey bg-honey-soft text-ink' : 'border-line text-muted'}`}>
          <input type="checkbox" checked={agent.enabled} disabled={!agent.aiConfigured || saving} onChange={(e) => onToggle(e.target.checked)} className="size-4 accent-honey" />
          {agent.enabled ? 'Activo' : 'Apagado'}
        </label>
      }
    >
      <div className="flex flex-wrap gap-2">
        <Badge tone={agent.aiConfigured ? 'success' : 'neutral'}>{agent.aiConfigured ? '● Modelo conectado' : '○ Modelo sin conectar'}</Badge>
        <Badge tone={agent.knowledgeConfigured ? 'success' : 'neutral'}>{agent.knowledgeConfigured ? '● Búsqueda en la base activa' : '○ Búsqueda sin conectar'}</Badge>
      </div>
      {!agent.aiConfigured && (
        <p className="mt-3 rounded-lg bg-info-soft px-3 py-2 text-xs text-ink">
          Todavía no hay un modelo de IA conectado. Puedes dejar todo configurado y probar el simulador; el asistente se activa cuando se conecte.
        </p>
      )}
      {u && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between text-xs">
            <span className="font-semibold text-ink">Respuestas este mes</span>
            <span className="text-muted"><strong className="text-ink">{u.used.toLocaleString('es-CO')}</strong> de {u.limit.toLocaleString('es-CO')}</span>
          </div>
          <Meter percent={u.percent} label="Uso de la cuota mensual del asistente" />
          {u.percent >= 80 && (
            <p className={`mt-1.5 text-xs ${u.exhausted ? 'text-danger' : 'text-ink'}`}>
              {u.exhausted
                ? (u.blockOnQuota ? 'Se agotó la cuota: el asistente no responde hasta el próximo mes o hasta que cambies de plan.' : 'Se agotó la cuota: el asistente sigue respondiendo porque desactivaste el bloqueo.')
                : `Va por el ${u.percent} % de la cuota del mes.`}
            </p>
          )}
        </div>
      )}
    </SettingsSection>
  );
}

function AgentBehavior({ agent, saving, onSave }: { agent: Agent; saving: boolean; onSave: (body: Partial<Agent>) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      name: String(form.get('name')),
      tone: form.get('tone') as Agent['tone'],
      language: form.get('language') as Agent['language'],
      schedule: form.get('schedule') as Agent['schedule'],
      instructions: String(form.get('instructions')),
    });
  }
  return (
    <SettingsSection icon="☺" title="Cómo se presenta" description="Nombre, tono, idioma, horario y lo que tiene que saber de tu negocio.">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <label className={`${labelClass} sm:col-span-2`}>Nombre del asistente
          <input name="name" defaultValue={agent.name} required maxLength={60} className={inputClass} />
        </label>
        <label className={labelClass}>Tono
          <select name="tone" defaultValue={agent.tone} className={inputClass}>{Object.entries(TONES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className={labelClass}>Idioma
          <select name="language" defaultValue={agent.language} className={inputClass}>{Object.entries(LANGUAGES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className={`${labelClass} sm:col-span-2`}>Cuándo atiende
          <select name="schedule" defaultValue={agent.schedule} className={inputClass}>{Object.entries(SCHEDULES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <span className="font-normal">Usa el horario laboral de la pestaña General. Si el asistente no atiende, sale el mensaje automático de fuera de horario.</span>
        </label>
        <label className={`${labelClass} sm:col-span-2`}>Información del negocio
          <textarea name="instructions" defaultValue={agent.instructions} maxLength={8000} rows={5} placeholder="Qué vendes, zonas de entrega, cómo cotizas, qué no haces…" className={textareaClass} />
          <span className="font-normal">Los precios y descuentos que no estén aquí o en la base de conocimiento, el asistente no los puede decir.</span>
        </label>
        <div className="sm:col-span-2"><button type="submit" disabled={saving} className={primaryButton}>{saving ? 'Guardando…' : 'Guardar'}</button></div>
      </form>
    </SettingsSection>
  );
}

function HandoffSettings({ agent, saving, onSave }: { agent: Agent; saving: boolean; onSave: (body: Partial<Agent>) => void }) {
  const [keywords, setKeywords] = useState(agent.handoffKeywords);
  const [draft, setDraft] = useState('');
  function add() {
    const word = draft.trim().toLowerCase();
    if (word.length >= 2 && !keywords.includes(word)) setKeywords([...keywords, word]);
    setDraft('');
  }
  return (
    <SettingsSection icon="⇄" title="Traspaso a una persona" description="Cuando el cliente escribe una de estas palabras, el asistente le avisa que lo atiende el equipo y se pausa en esa conversación.">
      <ul className="flex flex-wrap gap-2" aria-label="Palabras de escalamiento">
        {keywords.map((k) => (
          <li key={k} className="inline-flex items-center gap-1 rounded-full bg-honey-soft py-0.5 pl-3 pr-1 text-xs text-ink">
            {k}
            <button type="button" onClick={() => setKeywords(keywords.filter((x) => x !== k))} aria-label={`Quitar ${k}`} className="grid size-6 place-items-center rounded-full text-muted hover:bg-honey/40 hover:text-ink">×</button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          maxLength={40} placeholder="Agregar palabra o frase" aria-label="Nueva palabra de escalamiento" className={`${inputClass} min-w-0 flex-1`} />
        <button type="button" onClick={add} className={secondaryButton}>+ Agregar</button>
      </div>
      <p className="mt-3 text-xs text-muted">
        También se pausa 24 horas cuando una persona del equipo responde, y puedes pausarlo o reanudarlo desde cada conversación.
      </p>
      <label className="mt-4 flex items-start gap-3 rounded-lg border border-line p-3">
        <input type="checkbox" checked={agent.blockOnQuota} onChange={(e) => onSave({ blockOnQuota: e.target.checked })} className="mt-0.5 size-4 accent-honey" />
        <span className="text-xs">
          <span className="block font-semibold text-ink">Dejar de responder al agotar la cuota del mes</span>
          <span className="block text-muted">Si lo desactivas, el asistente sigue respondiendo y te avisamos al 80 % y al 100 %.</span>
        </span>
      </label>
      <div className="mt-4">
        <button type="button" disabled={saving} onClick={() => onSave({ handoffKeywords: keywords })} className={primaryButton}>Guardar palabras</button>
      </div>
    </SettingsSection>
  );
}

function QualificationSettings({ agent, saving, onSave }: { agent: Agent; saving: boolean; onSave: (qualification: string[]) => void }) {
  const [selected, setSelected] = useState(new Set(agent.qualification));
  const toggle = (target: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(target)) next.delete(target); else next.add(target);
    return next;
  });
  return (
    <SettingsSection icon="☷" title="Datos que captura" description="Lo que el cliente cuente en la conversación se guarda en su ficha y en el negocio. Nunca pisa lo que ya cargó alguien del equipo.">
      <div className="grid gap-2 sm:grid-cols-2">
        {agent.qualificationOptions.map((o) => (
          <label key={o.target} className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs ${selected.has(o.target) ? 'border-honey bg-honey-soft/40 text-ink' : 'border-line text-muted'}`}>
            <input type="checkbox" checked={selected.has(o.target)} onChange={() => toggle(o.target)} className="size-4 accent-honey" />
            {o.label}
          </label>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">Para capturar otros datos, crea campos personalizados en Contactos o Negocios y aparecen aquí.</p>
      <div className="mt-4"><button type="button" disabled={saving} onClick={() => onSave([...selected])} className={primaryButton}>Guardar datos</button></div>
    </SettingsSection>
  );
}

function AgentSimulator({ aiConfigured, labels }: { aiConfigured: boolean; labels: Record<string, string> }) {
  const [message, setMessage] = useState('');
  const preview = useMutation({
    mutationFn: (text: string) => api<Preview>('/api/v1/ai/agent/preview', { method: 'POST', body: JSON.stringify({ message: text }) }),
  });
  const p = preview.data;
  return (
    <SettingsSection icon="▷" title="Simulador" description="Escribe como si fueras un cliente. Corre igual que en WhatsApp (búsqueda, reglas y controles) pero no le envía nada a nadie.">
      <form onSubmit={(e) => { e.preventDefault(); if (message.trim()) preview.mutate(message); }} className="flex gap-2">
        <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} placeholder="¿Cuánto cuesta el alquiler por un mes?" aria-label="Mensaje de prueba" className={`${inputClass} min-w-0 flex-1`} />
        <button type="submit" disabled={preview.isPending} className={primaryButton}>{preview.isPending ? 'Pensando…' : 'Probar'}</button>
      </form>
      {preview.isError && <div className="mt-3"><Alert>No pudimos probar el asistente.</Alert></div>}
      {p && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
            <p className="max-w-[85%] self-end rounded-lg bg-surface px-3 py-2 text-sm text-ink shadow-sm">{preview.variables}</p>
            <p className="max-w-[85%] self-start rounded-lg bg-honey-soft px-3 py-2 text-sm text-ink">
              {p.reply ?? (aiConfigured ? 'Sin respuesta.' : 'Sin respuesta: el modelo todavía no está conectado. Abajo ves las instrucciones que recibiría.')}
            </p>
          </div>
          {p.outcome && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone={OUTCOMES[p.outcome].tone}>{OUTCOMES[p.outcome].label}</Badge>
              {p.violations?.map((v) => <Badge key={v} tone="danger">{VIOLATIONS[v] ?? v}</Badge>)}
              {p.latencyMs !== undefined && <span className="text-muted">{(p.latencyMs / 1000).toFixed(1)} s</span>}
              {Boolean(p.sources?.length) && <span className="text-muted">Usó: {p.sources!.map((s) => s.title).join(', ')}</span>}
            </div>
          )}
          {p.fields && Object.keys(p.fields).length > 0 && (
            <dl className="grid gap-1 rounded-lg border border-line p-3 text-xs sm:grid-cols-2">
              {Object.entries(p.fields).map(([k, v]) => <div key={k}><dt className="inline font-semibold text-muted">{labels[k] ?? k}: </dt><dd className="inline text-ink">{String(v)}</dd></div>)}
            </dl>
          )}
          <details>
            <summary className="inline-flex min-h-10 cursor-pointer items-center text-xs text-muted hover:text-ink">Ver las instrucciones que recibe el asistente</summary>
            <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-honey-soft/30 p-3 text-[11px] text-ink">{p.systemPrompt}</pre>
          </details>
        </div>
      )}
    </SettingsSection>
  );
}
