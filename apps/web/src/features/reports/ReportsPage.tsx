import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../shared/api';
import { useRegion } from '../../shared/i18n/use-region';
import { AppShell } from '../../shared/ui/app-shell';
import { Alert } from '../../shared/ui/form';
import { EmptyState, IconTile, inputClass, labelClass, Segmented, StatTile, tableHeadClass } from '../../shared/ui/section';

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

const RANGES = [['7', '7 días'], ['30', '30 días'], ['90', '90 días'], ['custom', 'Personalizado']] as const;
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
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Segmented label="Rango de fechas" options={RANGES} value={preset} onChange={setPreset} />
        {preset === 'custom' && (
          <>
            <label className={labelClass}>Desde<input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className={inputClass} /></label>
            <label className={labelClass}>Hasta<input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className={inputClass} /></label>
          </>
        )}
      </div>

      {overview.isError && <Alert>No pudimos cargar los reportes.</Alert>}
      {o && (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Leads nuevos" value={o.newLeads.toLocaleString('es-CO')} />
            <StatTile label="Valor del embudo abierto" value={money(o.pipelineValue)} />
            <StatTile label={`Ganados (${o.won.count})`} value={money(o.won.value)} />
            <StatTile label="Tasa de conversión" value={pct(o.conversionRate)} hint={`${o.won.count} ganados de ${o.won.count + o.lost.count} cerrados`} />
          </dl>

          <section aria-labelledby="stages-title" className="rounded-xl border border-line bg-surface p-4 shadow-sm">
            <div className="flex items-center gap-3"><IconTile>▣</IconTile><h2 id="stages-title" className="text-sm font-semibold text-ink">Negocios abiertos por etapa</h2></div>
            {!o.dealsByStage.some((st) => st.count) && <div className="mt-3"><EmptyState icon="▣" title="Sin negocios abiertos">Cuando entren negocios al embudo, aquí ves cuánto hay en cada etapa.</EmptyState></div>}
            <ul className="mt-3 flex flex-col gap-2">
              {o.dealsByStage.map((s) => (
                <li key={s.stageId} className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3 text-xs" title={`${s.name}: ${s.count} negocios · ${money(s.value)}`}>
                  <span className="truncate text-ink">{s.name}</span>
                  <span className="h-2.5 rounded-full bg-raised">
                    <span className="block h-full rounded-full bg-honey" style={{ width: `${(s.value / maxStage) * 100}%`, minWidth: s.value ? 4 : 0 }} />
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
          <Table icon="♙" title="Por responsable" head={['Responsable', 'Negocios', 'Ganados', 'Ingresos', 'Conversión']}
            rows={performance.data.byOwner.map((r) => [r.name, r.deals, r.won, money(r.wonValue), pct(r.conversionRate)])} />
          <Table icon="↗" title="Por fuente" head={['Fuente', 'Leads', 'Ganados', 'Ingresos', 'Conversión']}
            rows={performance.data.bySource.map((r) => [r.source === 'sin_origen' ? 'Sin origen' : r.source, r.leads, r.won, money(r.wonValue), pct(r.conversionRate)])} />
        </div>
      )}

      {response.data && (
        <section className="mt-6" aria-labelledby="response-title">
          <div className="flex items-center gap-3">
            <IconTile>⏱</IconTile>
            <div>
              <h2 id="response-title" className="text-sm font-semibold text-ink">Primera respuesta</h2>
              <p className="text-xs text-muted">SLA: {response.data.slaMinutes} minutos. Solo cuentan respuestas de personas, no las del asistente ni las automáticas.</p>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Promedio" value={minutes(response.data.overall.avgMinutes)} />
            <StatTile label="Conversaciones atendidas" value={String(response.data.overall.conversations)} />
            <StatTile label="Fuera de SLA" value={String(response.data.overall.breaches)} />
            <StatTile label="Sin responder" value={String(response.data.overall.pending)} hint={response.data.overall.pendingBreaches ? `${response.data.overall.pendingBreaches} ya fuera de SLA` : undefined} />
          </dl>
          <div className="mt-3">
            <Table icon="☺" title="Por persona" head={['Persona', 'Conversaciones', 'Promedio', 'Fuera de SLA']}
              rows={response.data.byResponder.map((r) => [r.name ?? '—', r.conversations, minutes(r.avgMinutes), r.breaches])} />
          </div>
        </section>
      )}
    </AppShell>
  );
}

function Table({ icon, title, head, rows }: { icon: string; title: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3"><IconTile>{icon}</IconTile><h2 className="text-sm font-semibold text-ink">{title}</h2></div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className={tableHeadClass}><tr>{head.map((h) => <th key={h} scope="col" className="px-4 py-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`px-4 py-2 ${j === 0 ? 'font-semibold text-ink' : 'text-ink'}`}>{c}</td>)}</tr>)}
            {!rows.length && <tr><td colSpan={head.length} className="px-4 py-4 text-center text-muted">Sin datos en este período.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
