import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../shared/api';
import { useRegion } from '../../shared/i18n/use-region';
import { AppShell } from '../../shared/ui/app-shell';
import { Alert } from '../../shared/ui/form';

interface Overview {
  newLeads: number;
  pipelineValue: number;
  won: { count: number; value: number };
  lost: { count: number; value: number };
  conversionRate: number | null;
  dealsByStage: { stageId: string; name: string; count: number; value: number }[];
}
interface Row { deals: number; won: number; lost: number; wonValue: number; conversionRate: number | null }
interface Performance { byOwner: (Row & { ownerId: string | null; name: string })[]; bySource: (Row & { source: string; leads: number })[] }
interface ResponseTimes {
  slaMinutes: number;
  byResponder: { userId: string; name: string | null; conversations: number; avgMinutes: number; breaches: number }[];
  overall: { conversations: number; avgMinutes: number | null; breaches: number; pending: number; pendingBreaches: number };
}

const RANGES = [['7', 'Últimos 7 días'], ['30', 'Últimos 30 días'], ['90', 'Últimos 90 días'], ['custom', 'Personalizado']] as const;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)} %`);
const minutes = (v: number | null) => (v === null ? '—' : v < 60 ? `${Math.round(v)} min` : `${(v / 60).toFixed(1)} h`);

/** E08-S01/S02/S03 — Reportes con rango de fechas. El vendedor ve solo sus números (lo decide la API). */
export function ReportsPage() {
  const { money } = useRegion();
  const [preset, setPreset] = useState<(typeof RANGES)[number][0]>('30');
  const [custom, setCustom] = useState({ from: isoDay(new Date(Date.now() - 29 * 86_400_000)), to: isoDay(new Date()) });
  const range = preset === 'custom' ? custom : { from: isoDay(new Date(Date.now() - (Number(preset) - 1) * 86_400_000)), to: isoDay(new Date()) };
  const qs = `from=${range.from}&to=${range.to}`;
  const overview = useQuery({ queryKey: ['reports', 'overview', qs], queryFn: () => api<Overview>(`/api/v1/reports/overview?${qs}`) });
  const performance = useQuery({ queryKey: ['reports', 'performance', qs], queryFn: () => api<Performance>(`/api/v1/reports/performance?${qs}`) });
  const response = useQuery({ queryKey: ['reports', 'response', qs], queryFn: () => api<ResponseTimes>(`/api/v1/reports/response-times?${qs}`) });

  const o = overview.data;
  const maxStage = Math.max(1, ...(o?.dealsByStage.map((s) => s.value) ?? [0]));

  return (
    <AppShell title="Reportes" subtitle="Cómo viene el embudo, el equipo y la atención." wide>
      <div className="mb-4 flex flex-wrap items-end gap-2" role="group" aria-label="Rango de fechas">
        {RANGES.map(([value, label]) => (
          <button key={value} onClick={() => setPreset(value)} aria-pressed={preset === value}
            className={`min-h-11 rounded-full border px-4 text-sm ${preset === value ? 'border-ink bg-ink text-surface' : 'border-line text-ink'}`}>{label}</button>
        ))}
        {preset === 'custom' && (
          <>
            <label className="flex flex-col text-xs text-muted">Desde<input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink" /></label>
            <label className="flex flex-col text-xs text-muted">Hasta<input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink" /></label>
          </>
        )}
      </div>

      {overview.isError && <Alert>No pudimos cargar los reportes.</Alert>}
      {o && (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Leads nuevos" value={o.newLeads.toLocaleString('es-CO')} />
            <Stat label="Valor del embudo abierto" value={money(o.pipelineValue)} />
            <Stat label={`Ganados (${o.won.count})`} value={money(o.won.value)} />
            <Stat label="Tasa de conversión" value={pct(o.conversionRate)} hint={`${o.won.count} ganados de ${o.won.count + o.lost.count} cerrados`} />
          </dl>

          <section aria-labelledby="stages-title" className="rounded-xl border border-line bg-surface p-4">
            <h2 id="stages-title" className="font-semibold text-ink">Negocios abiertos por etapa</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {o.dealsByStage.map((s) => (
                <li key={s.stageId} className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3 text-sm" title={`${s.name}: ${s.count} negocios · ${money(s.value)}`}>
                  <span className="truncate text-ink">{s.name}</span>
                  <span className="h-3 rounded-r bg-canvas">
                    <span className="block h-full rounded-r bg-honey" style={{ width: `${(s.value / maxStage) * 100}%`, minWidth: s.value ? 4 : 0 }} />
                  </span>
                  <span className="whitespace-nowrap text-muted">{s.count} · {money(s.value)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {performance.data && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Table title="Por responsable" head={['Responsable', 'Negocios', 'Ganados', 'Ingresos', 'Conversión']}
            rows={performance.data.byOwner.map((r) => [r.name, r.deals, r.won, money(r.wonValue), pct(r.conversionRate)])} />
          <Table title="Por fuente" head={['Fuente', 'Leads', 'Ganados', 'Ingresos', 'Conversión']}
            rows={performance.data.bySource.map((r) => [r.source === 'sin_origen' ? 'Sin origen' : r.source, r.leads, r.won, money(r.wonValue), pct(r.conversionRate)])} />
        </div>
      )}

      {response.data && (
        <section className="mt-6" aria-labelledby="response-title">
          <h2 id="response-title" className="font-semibold text-ink">Primera respuesta</h2>
          <p className="mt-1 text-sm text-muted">SLA: {response.data.slaMinutes} minutos. Solo cuentan respuestas de personas, no las automáticas.</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Promedio" value={minutes(response.data.overall.avgMinutes)} />
            <Stat label="Conversaciones atendidas" value={String(response.data.overall.conversations)} />
            <Stat label="Fuera de SLA" value={String(response.data.overall.breaches)} />
            <Stat label="Sin responder" value={String(response.data.overall.pending)} hint={response.data.overall.pendingBreaches ? `${response.data.overall.pendingBreaches} ya fuera de SLA` : undefined} />
          </dl>
          <div className="mt-3">
            <Table title="Por persona" head={['Persona', 'Conversaciones', 'Promedio', 'Fuera de SLA']}
              rows={response.data.byResponder.map((r) => [r.name ?? '—', r.conversations, minutes(r.avgMinutes), r.breaches])} />
          </div>
        </section>
      )}
    </AppShell>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-xl font-semibold text-ink">{value}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}

function Table({ title, head, rows }: { title: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <section className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-left text-sm">
        <caption className="px-4 pt-3 text-left font-semibold text-ink">{title}</caption>
        <thead className="text-xs text-muted"><tr>{head.map((h) => <th key={h} scope="col" className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="px-4 py-2 text-ink">{c}</td>)}</tr>)}
          {!rows.length && <tr><td colSpan={head.length} className="px-4 py-3 text-muted">Sin datos en este período.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
