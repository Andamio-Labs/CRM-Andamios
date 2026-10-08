import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, ApiError, upload } from '../../shared/api';
import { useRegion } from '../../shared/i18n/use-region';
import { Alert } from '../../shared/ui/form';
import {
  Badge, type BadgeTone, EmptyState, inputClass, labelClass, linkButton, primaryButton, Segmented, SettingsSection, textareaClass,
} from '../../shared/ui/section';

type Kind = 'text' | 'faq' | 'pdf' | 'url';
interface Source {
  id: string; kind: Kind; title: string; status: 'waiting_ai' | 'indexing' | 'ready' | 'failed';
  error: string | null; chunkCount: number; updatedAt: string; url: string | null; fileName: string | null;
}
interface FaqItem { question: string; answer: string }

const KINDS: readonly (readonly [Kind, string])[] = [['text', 'Texto'], ['faq', 'Preguntas frecuentes'], ['pdf', 'PDF'], ['url', 'Página web']];
const KIND_LABEL: Record<Kind, string> = { text: 'Texto', faq: 'Preguntas', pdf: 'PDF', url: 'Web' };
const STATUS: Record<Source['status'], { label: string; tone: BadgeTone }> = {
  waiting_ai: { label: 'Esperando IA', tone: 'neutral' },
  indexing: { label: 'Indexando', tone: 'honey' },
  ready: { label: 'Lista', tone: 'success' },
  failed: { label: 'Con error', tone: 'danger' },
};

/** E05-S02 — Lo único que el asistente sabe del negocio: textos, preguntas frecuentes, PDF y páginas web. */
export function KnowledgeBase({ knowledgeConfigured }: { knowledgeConfigured: boolean }) {
  const { date } = useRegion();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<Kind>('text');
  const [faq, setFaq] = useState<FaqItem[]>([{ question: '', answer: '' }]);
  const sources = useQuery({
    queryKey: ['knowledge'],
    queryFn: () => api<Source[]>('/api/v1/ai/knowledge'),
    // Mientras algo se indexa, se vuelve a consultar hasta que quede lista.
    refetchInterval: (query) => (query.state.data?.some((s) => s.status === 'indexing') ? 3000 : false),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['knowledge'] });
  const create = useMutation({
    mutationFn: (form: FormData) => {
      const title = String(form.get('title'));
      if (kind === 'pdf') return upload<Source>('/api/v1/ai/knowledge/pdf', form);
      const body = kind === 'text' ? { kind, title, content: String(form.get('content')) }
        : kind === 'url' ? { kind, title, url: String(form.get('url')) }
          : { kind, title, items: faq.filter((i) => i.question.trim() && i.answer.trim()) };
      return api<Source>('/api/v1/ai/knowledge', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => { setFaq([{ question: '', answer: '' }]); return refresh(); },
  });
  const reread = useMutation({ mutationFn: (id: string) => api(`/api/v1/ai/knowledge/${id}/refresh`, { method: 'POST' }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/v1/ai/knowledge/${id}`, { method: 'DELETE' }), onSuccess: refresh });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    create.mutate(new FormData(formEl), { onSuccess: () => formEl.reset() });
  }

  return (
    <SettingsSection icon="▤" title="Base de conocimiento" description="El asistente responde SOLO con lo que cargues aquí y en la información del negocio. Si no lo encuentra, pasa a una persona.">
      {!knowledgeConfigured && (
        <p className="mb-3 rounded-lg bg-info-soft px-3 py-2 text-xs text-ink">La búsqueda todavía no está conectada: lo que cargues queda guardado y se indexa solo cuando se conecte.</p>
      )}
      {sources.data?.length === 0 && <EmptyState icon="+" title="Todavía no hay nada cargado">Empieza por tus precios y las preguntas que más te hacen.</EmptyState>}
      {Boolean(sources.data?.length) && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {sources.data!.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-ink">{s.title}</span>
                <span className="block truncate text-[11px] text-muted">
                  {KIND_LABEL[s.kind]}{s.fileName ? ` · ${s.fileName}` : ''}{s.url ? ` · ${s.url}` : ''} · {s.chunkCount} fragmentos · {date(s.updatedAt)}
                </span>
              </span>
              <Badge tone={STATUS[s.status].tone} title={s.error ?? undefined}>{STATUS[s.status].label}</Badge>
              {s.kind === 'url' && <button onClick={() => reread.mutate(s.id)} disabled={reread.isPending} className={linkButton}>Volver a leer</button>}
              <button onClick={() => { if (confirm(`¿Eliminar "${s.title}"?`)) remove.mutate(s.id); }} className={`${linkButton} text-danger`}>Eliminar</button>
            </li>
          ))}
        </ul>
      )}
      {reread.isError && <div className="mt-2"><Alert>{reread.error instanceof ApiError ? reread.error.message : 'No pudimos volver a leer la página.'}</Alert></div>}

      <form onSubmit={submit} className="mt-4 flex flex-col gap-4 border-t border-line pt-4">
        <Segmented label="Tipo de fuente" options={KINDS} value={kind} onChange={setKind} />
        <label className={labelClass}>Título
          <input name="title" required maxLength={200} placeholder={kind === 'faq' ? 'Preguntas frecuentes' : kind === 'url' ? 'Página de precios' : 'Lista de precios 2026'} className={inputClass} />
        </label>
        {kind === 'text' && (
          <label className={labelClass}>Contenido
            <textarea name="content" required maxLength={100_000} rows={6} className={textareaClass} />
          </label>
        )}
        {kind === 'pdf' && (
          <label className={labelClass}>Archivo PDF (hasta 10 MB, con texto seleccionable)
            <input name="file" type="file" accept="application/pdf,.pdf" required className="text-xs text-ink file:mr-3 file:min-h-10 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:text-xs file:font-semibold file:text-ink" />
          </label>
        )}
        {kind === 'url' && (
          <label className={labelClass}>Dirección de la página
            <input name="url" type="url" required maxLength={2000} placeholder="https://tuempresa.com/precios" className={inputClass} />
            <span className="font-normal">Se guarda el texto de la página. Si la cambias, usa “Volver a leer”.</span>
          </label>
        )}
        {kind === 'faq' && (
          <div className="flex flex-col gap-2">
            {faq.map((item, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-2">
                <input aria-label={`Pregunta ${i + 1}`} placeholder="Pregunta" value={item.question} maxLength={500} onChange={(e) => setFaq(faq.map((f, j) => (j === i ? { ...f, question: e.target.value } : f)))} className={inputClass} />
                <input aria-label={`Respuesta ${i + 1}`} placeholder="Respuesta" value={item.answer} maxLength={4000} onChange={(e) => setFaq(faq.map((f, j) => (j === i ? { ...f, answer: e.target.value } : f)))} className={inputClass} />
              </div>
            ))}
            <button type="button" onClick={() => setFaq([...faq, { question: '', answer: '' }])} className={`${linkButton} self-start`}>+ Agregar pregunta</button>
          </div>
        )}
        {create.isError && <Alert>{create.error instanceof ApiError ? create.error.message : 'No se pudo guardar.'}</Alert>}
        <div><button type="submit" disabled={create.isPending} className={primaryButton}>{create.isPending ? 'Cargando…' : '+ Cargar'}</button></div>
      </form>
    </SettingsSection>
  );
}
