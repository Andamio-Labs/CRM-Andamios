import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { useRegion } from '../../shared/i18n/use-region';
import { Alert, Button, Field } from '../../shared/ui/form';

interface Source { id: string; kind: 'text' | 'faq'; title: string; status: 'waiting_ai' | 'indexing' | 'ready' | 'failed'; error: string | null; chunkCount: number; updatedAt: string }
interface FaqItem { question: string; answer: string }

const STATUS = {
  waiting_ai: { label: 'Esperando IA', className: 'bg-canvas text-muted' },
  indexing: { label: 'Indexando', className: 'bg-honey-soft text-ink' },
  ready: { label: 'Lista', className: 'bg-honey/25 text-ink' },
  failed: { label: 'Con error', className: 'bg-danger/10 text-danger' },
} as const;
const inputClass = 'rounded-lg border border-line bg-surface p-3 text-sm text-ink';

/** E05-S02 — Base de conocimiento del agente: textos y preguntas frecuentes. */
export function KnowledgeSettings() {
  const { date } = useRegion();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<Source['kind']>('text');
  const [faq, setFaq] = useState<FaqItem[]>([{ question: '', answer: '' }]);
  const sources = useQuery({ queryKey: ['knowledge'], queryFn: () => api<Source[]>('/api/v1/ai/knowledge'), retry: false });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['knowledge'] });
  const create = useMutation({
    mutationFn: (body: object) => api<Source>('/api/v1/ai/knowledge', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { setFaq([{ question: '', answer: '' }]); return refresh(); },
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/v1/ai/knowledge/${id}`, { method: 'DELETE' }), onSuccess: refresh });

  if (sources.isError) return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const title = String(form.get('title'));
    const body = kind === 'text'
      ? { kind, title, content: String(form.get('content')) }
      : { kind, title, items: faq.filter((i) => i.question.trim() && i.answer.trim()) };
    create.mutate(body, { onSuccess: () => formEl.reset() });
  }

  return (
    <div className="mt-6">
      <h3 className="font-medium text-ink">Base de conocimiento</h3>
      <p className="mt-1 text-sm text-muted">El agente solo responde con lo que cargues acá. PDF y páginas web llegan junto con la IA.</p>

      <ul className="mt-3 flex flex-col gap-2">
        {sources.data?.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{s.title}</span>
            <span className="text-xs text-muted">{s.kind === 'faq' ? 'Preguntas' : 'Texto'} · {s.chunkCount} fragmentos · {date(s.updatedAt)}</span>
            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${STATUS[s.status].className}`} title={s.error ?? undefined}>{STATUS[s.status].label}</span>
            <button onClick={() => { if (confirm(`¿Eliminar "${s.title}"?`)) remove.mutate(s.id); }} className="inline-flex min-h-11 items-center px-2 text-sm text-ink underline">Eliminar</button>
          </li>
        ))}
        {sources.data?.length === 0 && <li className="text-sm text-muted">Todavía no hay nada cargado.</li>}
      </ul>

      <form onSubmit={submit} className="mt-3 flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
        <div role="radiogroup" aria-label="Tipo" className="flex gap-4">
          {(['text', 'faq'] as const).map((k) => (
            <label key={k} className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
              <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} /> {k === 'text' ? 'Texto' : 'Preguntas frecuentes'}
            </label>
          ))}
        </div>
        <Field label="Título" name="title" required maxLength={200} />
        {kind === 'text' ? (
          <label className="flex flex-col gap-1 text-sm text-ink">Contenido
            <textarea name="content" required maxLength={100_000} rows={6} className={inputClass} />
          </label>
        ) : (
          <div className="flex flex-col gap-2">
            {faq.map((item, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-2">
                <input aria-label={`Pregunta ${i + 1}`} placeholder="Pregunta" value={item.question} maxLength={500} onChange={(e) => setFaq(faq.map((f, j) => (j === i ? { ...f, question: e.target.value } : f)))} className={`${inputClass} min-h-11`} />
                <input aria-label={`Respuesta ${i + 1}`} placeholder="Respuesta" value={item.answer} maxLength={4000} onChange={(e) => setFaq(faq.map((f, j) => (j === i ? { ...f, answer: e.target.value } : f)))} className={`${inputClass} min-h-11`} />
              </div>
            ))}
            <button type="button" onClick={() => setFaq([...faq, { question: '', answer: '' }])} className="inline-flex min-h-11 items-center self-start text-sm text-ink underline">Agregar pregunta</button>
          </div>
        )}
        {create.isError && <Alert>{create.error instanceof ApiError && create.error.status === 400 ? 'Revisá el contenido: no puede estar vacío.' : 'No se pudo guardar.'}</Alert>}
        <Button type="submit" loading={create.isPending} className="self-start">Cargar</Button>
      </form>
    </div>
  );
}
