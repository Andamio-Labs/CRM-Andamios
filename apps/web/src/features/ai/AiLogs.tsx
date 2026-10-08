import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../../shared/api';
import { useRegion } from '../../shared/i18n/use-region';
import { Badge, EmptyState, linkButton, Segmented, SettingsSection, tableHeadClass } from '../../shared/ui/section';
import { formatUsd, OUTCOMES, type Outcome, VIOLATIONS } from './ai-format';

interface Item {
  id: string; createdAt: string; channel: 'whatsapp' | 'preview'; outcome: Outcome; model: string | null;
  inputTokens: number; outputTokens: number; costMicros: number; latencyMs: number | null; violations: string[];
  conversationId: string | null; contactName: string | null; error: string | null;
}
interface Page { items: Item[]; nextCursor: string | null; month: { interactions: number; costMicros: number; inputTokens: number; outputTokens: number } }
interface Detail { prompt: { system: string; messages: { role: string; content: string }[] }; response: string | null; captured: Record<string, unknown>; sources: { title: string }[]; error: string | null }

const FILTERS = [['', 'Todo'], ['replied', 'Respondió'], ['handoff', 'Pasó a una persona'], ['blocked', 'Frenadas'], ['error', 'Errores']] as const;

/** E05-S08 — Registro de cada turno del asistente con modelo, tokens y costo. Solo el propietario. */
export function AiLogs() {
  const { date, time } = useRegion();
  const [outcome, setOutcome] = useState<(typeof FILTERS)[number][0]>('');
  const [open, setOpen] = useState<string>();
  const log = useInfiniteQuery({
    queryKey: ['ai-interactions', outcome],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<Page>(`/api/v1/ai/interactions?limit=30${outcome ? `&outcome=${outcome}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  if (log.isError) return null; // solo el propietario ve prompts y costos
  const items = log.data?.pages.flatMap((p) => p.items) ?? [];
  const month = log.data?.pages[0]?.month;

  return (
    <SettingsSection
      icon="☰"
      title="Registro del asistente"
      description="Cada respuesta con lo que recibió el modelo, lo que contestó, los tokens y el costo. Solo lo ve el propietario."
      action={month && <span className="text-right text-xs text-muted"><strong className="block text-sm text-ink">{formatUsd(month.costMicros)}</strong>{month.interactions.toLocaleString('es-CO')} turnos este mes</span>}
    >
      <Segmented label="Filtrar el registro" options={FILTERS} value={outcome} onChange={setOutcome} />
      {log.isSuccess && !items.length && <div className="mt-3"><EmptyState icon="☰" title="Sin registros">Cuando el asistente responda, cada turno aparece aquí.</EmptyState></div>}
      {Boolean(items.length) && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[36rem] text-left text-xs">
            <thead className={tableHeadClass}>
              <tr><th scope="col" className="px-3 py-2">Cuándo</th><th scope="col" className="px-3 py-2">Cliente</th><th scope="col" className="px-3 py-2">Resultado</th><th scope="col" className="px-3 py-2 text-right">Tokens</th><th scope="col" className="px-3 py-2 text-right">Costo</th><th scope="col" className="px-3 py-2"><span className="sr-only">Detalle</span></th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((i) => (
                <tr key={i.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{date(i.createdAt)} {time(i.createdAt)}</td>
                  <td className="px-3 py-2 text-ink">
                    {i.channel === 'preview' ? <span className="text-muted">Simulador</span>
                      : i.conversationId ? <Link to="/inbox" search={{ c: i.conversationId }} className="font-semibold underline-offset-2 hover:underline">{i.contactName ?? 'Cliente'}</Link>
                        : <span className="text-muted">Conversación eliminada</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={OUTCOMES[i.outcome].tone}>{OUTCOMES[i.outcome].label}</Badge>
                      {i.violations.map((v) => <Badge key={v} tone="danger">{VIOLATIONS[v] ?? v}</Badge>)}
                    </div>
                    {i.error && <p className="mt-1 text-[11px] text-muted">{i.error}</p>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-muted">{(i.inputTokens + i.outputTokens).toLocaleString('es-CO')}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-ink">{formatUsd(i.costMicros)}</td>
                  <td className="px-3 py-2 text-right"><button onClick={() => setOpen(open === i.id ? undefined : i.id)} aria-expanded={open === i.id} className={linkButton}>{open === i.id ? 'Cerrar' : 'Ver'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <InteractionDetail id={open} />}
      {log.hasNextPage && <button onClick={() => log.fetchNextPage()} className={`${linkButton} mt-2`}>{log.isFetchingNextPage ? 'Cargando…' : 'Ver más'}</button>}
    </SettingsSection>
  );
}

function InteractionDetail({ id }: { id: string }) {
  const detail = useQuery({ queryKey: ['ai-interaction', id], queryFn: () => api<Detail>(`/api/v1/ai/interactions/${id}`) });
  const d = detail.data;
  if (!d) return <p className="mt-3 text-xs text-muted">Cargando…</p>;
  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-line bg-canvas p-3 text-xs">
      <div>
        <p className="font-semibold text-ink">Conversación enviada al modelo</p>
        <ol className="mt-1 flex flex-col gap-1">
          {d.prompt.messages.map((m, i) => <li key={i} className={m.role === 'user' ? 'text-ink' : 'text-muted'}><strong>{m.role === 'user' ? 'Cliente' : 'Asistente'}:</strong> {m.content}</li>)}
        </ol>
      </div>
      {d.response && <div><p className="font-semibold text-ink">Respuesta del modelo</p><pre className="mt-1 whitespace-pre-wrap break-words text-ink">{d.response}</pre></div>}
      {Boolean(d.sources.length) && <p className="text-muted">Fuentes usadas: {d.sources.map((s) => s.title).join(', ')}</p>}
      {Object.keys(d.captured).length > 0 && <p className="text-muted">Datos guardados: {Object.entries(d.captured).map(([k, v]) => `${k} = ${String(v)}`).join(' · ')}</p>}
      {d.prompt.system && (
        <details>
          <summary className="inline-flex min-h-10 cursor-pointer items-center text-muted hover:text-ink">Instrucciones del sistema</summary>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface p-2 text-[11px] text-ink">{d.prompt.system}</pre>
        </details>
      )}
    </div>
  );
}
