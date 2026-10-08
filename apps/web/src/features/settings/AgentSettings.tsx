import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { Alert, Button, Field } from '../../shared/ui/form';
import { KnowledgeSettings } from './KnowledgeSettings';

interface Agent {
  name: string;
  tone: 'friendly' | 'formal' | 'neutral';
  language: 'es-CO' | 'es-MX' | 'pt-BR';
  schedule: 'always' | 'business_hours' | 'out_of_hours';
  instructions: string;
  enabled: boolean;
  aiConfigured: boolean;
}
interface Preview { systemPrompt: string; reply: string | null; aiConfigured: boolean }

const TONES = { friendly: 'Cercano', formal: 'Formal', neutral: 'Neutral' } as const;
const LANGUAGES = { 'es-CO': 'Español (Colombia)', 'es-MX': 'Español (México)', 'pt-BR': 'Portugués (Brasil)' } as const;
const SCHEDULES = { always: 'Siempre', business_hours: 'Solo en horario laboral', out_of_hours: 'Solo fuera del horario laboral' } as const;
const selectClass = 'min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink';

/** E05-S01 — Configuración del agente de IA con simulador. */
export function AgentSettings() {
  const queryClient = useQueryClient();
  const agent = useQuery({ queryKey: ['ai-agent'], queryFn: () => api<Agent>('/api/v1/ai/agent'), retry: false });
  const save = useMutation({
    mutationFn: (body: Partial<Agent>) => api<Agent>('/api/v1/ai/agent', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (data) => queryClient.setQueryData(['ai-agent'], data),
  });

  if (agent.isError) return null; // el vendedor no configura el agente: la sección no se muestra
  if (!agent.data) return null;
  const a = agent.data;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save.mutate({
      name: String(form.get('name')),
      tone: form.get('tone') as Agent['tone'],
      language: form.get('language') as Agent['language'],
      schedule: form.get('schedule') as Agent['schedule'],
      instructions: String(form.get('instructions')),
    });
  }

  return (
    <section className="mt-10" aria-labelledby="agent-title">
      <h2 id="agent-title" className="text-lg font-semibold text-ink">Agente de IA</h2>
      <p className="mt-1 text-sm text-muted">Cómo se presenta y qué sabe de tu negocio cuando responde por WhatsApp.</p>
      {!a.aiConfigured && <div className="mt-3"><Alert tone="success">La IA todavía no está conectada. Podés dejar todo configurado y probar el simulador; el agente se activa cuando la conectemos.</Alert></div>}

      <form key={a.name + a.instructions} onSubmit={submit} className="mt-3 flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
        <Field label="Nombre del agente" name="name" defaultValue={a.name} required maxLength={60} />
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm text-ink">Tono
            <select name="tone" defaultValue={a.tone} className={selectClass}>{Object.entries(TONES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">Idioma
            <select name="language" defaultValue={a.language} className={selectClass}>{Object.entries(LANGUAGES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">Atiende
            <select name="schedule" defaultValue={a.schedule} className={selectClass}>{Object.entries(SCHEDULES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm text-ink">Instrucciones del negocio
          <textarea name="instructions" defaultValue={a.instructions} maxLength={8000} rows={6} placeholder="Qué vendés, horarios, zonas de entrega, cómo cotizar…" className="rounded-lg border border-line bg-surface p-3 text-sm text-ink" />
        </label>
        {save.isError && <Alert>{save.error instanceof ApiError ? save.error.message : 'No se pudo guardar.'}</Alert>}
        <Button type="submit" loading={save.isPending} className="self-start">Guardar</Button>
      </form>

      <label className="mt-3 flex min-h-11 items-center gap-3">
        <input type="checkbox" checked={a.enabled} disabled={!a.aiConfigured} onChange={(e) => save.mutate({ enabled: e.target.checked })} className="size-5 accent-honey" />
        <span className="text-sm text-ink">Agente activo</span>
      </label>

      <KnowledgeSettings />
      <AgentSimulator />
    </section>
  );
}

function AgentSimulator() {
  const [message, setMessage] = useState('');
  const preview = useMutation({
    mutationFn: (text: string) => api<Preview>('/api/v1/ai/agent/preview', { method: 'POST', body: JSON.stringify({ message: text }) }),
  });

  return (
    <div className="mt-4 rounded-xl border border-line bg-surface p-4">
      <h3 className="font-medium text-ink">Simulador</h3>
      <form onSubmit={(e) => { e.preventDefault(); if (message.trim()) preview.mutate(message); }} className="mt-2 flex gap-2">
        <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} placeholder="Escribí como si fueras un cliente" aria-label="Mensaje de prueba" className="min-h-11 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink" />
        <Button type="submit" loading={preview.isPending}>Probar</Button>
      </form>
      {preview.isError && <div className="mt-2"><Alert>No pudimos probar el agente.</Alert></div>}
      {preview.data && (
        <div className="mt-3 flex flex-col gap-2 text-sm">
          <p className="text-ink">{preview.data.reply ?? 'Sin respuesta: la IA todavía no está conectada.'}</p>
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-muted">Ver las instrucciones que recibe el agente</summary>
            <pre className="whitespace-pre-wrap break-words rounded-lg bg-honey-soft/30 p-3 text-xs text-ink">{preview.data.systemPrompt}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
