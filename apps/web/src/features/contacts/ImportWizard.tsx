import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ApiError } from '../../shared/api';
import { Alert, Button } from '../../shared/ui/form';

interface Preview { id: string; headers: string[]; totalRows: number; sample: Record<string, string>[]; suggestedMapping: Record<string, string> }
interface Result { status: string; imported: number; skipped: number; reportUrl: string | null }

const TARGETS: [string, string][] = [
  ['', 'No importar'], ['name', 'Nombre'], ['phone', 'Teléfono'], ['email', 'Correo'], ['tags', 'Etiquetas'],
  ['notes', 'Notas'], ['source', 'Origen'], ['priority', 'Prioridad'], ['kind', 'Tipo'],
];

async function upload(file: File): Promise<Preview> {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/v1/imports', { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.code, json.message ?? 'No pudimos leer el archivo');
  return json as Preview;
}

/** E02-S08 — Subir, revisar el mapeo con vista previa, importar y descargar el reporte de errores. */
export function ImportWizard({ onDone }: { onDone: () => void }) {
  const [preview, setPreview] = useState<Preview>();
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const read = useMutation({ mutationFn: upload, onSuccess: (p) => { setPreview(p); setMapping(p.suggestedMapping); } });
  const start = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/imports/${preview!.id}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mapping }) });
      const json = await res.json();
      if (!res.ok) throw new ApiError(res.status, json.code, json.message);
      return json as Result;
    },
    onSuccess: onDone,
  });

  function onFile(event: FormEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (file) read.mutate(file);
  }

  return (
    <section aria-label="Importar clientes" className="mt-4 rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">CSV con encabezados, hasta 50.000 filas. Los duplicados (mismo teléfono o correo) se saltan y quedan en el reporte.</p>
      {!preview && (
        <label className="mt-3 flex min-h-11 flex-col gap-1.5 text-sm font-medium text-ink">
          Archivo CSV
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="text-sm" />
        </label>
      )}
      {read.isPending && <p className="mt-3 text-muted">Leyendo archivo…</p>}
      {read.isError && <div className="mt-3"><Alert>{read.error instanceof ApiError ? read.error.message : 'No pudimos leer el archivo.'}</Alert></div>}

      {preview && !start.data && (
        <>
          <p className="mt-3 text-sm text-ink">{preview.totalRows} filas. Elige qué es cada columna:</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead>
                <tr>
                  {preview.headers.map((h) => (
                    <th key={h} scope="col" className="px-2 py-2 align-bottom">
                      <span className="block text-xs text-muted">{h}</span>
                      <select aria-label={`Destino de la columna ${h}`} value={mapping[h] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))} className="mt-1 h-11 w-full rounded-md border border-line bg-surface px-2">
                        {TARGETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        {mapping[h]?.startsWith('custom.') && <option value={mapping[h]}>{mapping[h]!.slice(7)}</option>}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.sample.map((row, i) => <tr key={i}>{preview.headers.map((h) => <td key={h} className="truncate px-2 py-1 text-muted">{row[h]}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
          {start.isError && <div className="mt-3"><Alert>{start.error instanceof ApiError ? start.error.message : 'No pudimos importar.'}</Alert></div>}
          <div className="mt-3 flex gap-2">
            <Button onClick={() => start.mutate()} loading={start.isPending} disabled={!Object.values(mapping).includes('name')}>Importar {preview.totalRows} filas</Button>
            <button onClick={() => setPreview(undefined)} className="min-h-11 px-2 text-sm text-muted underline">Elegir otro archivo</button>
          </div>
        </>
      )}

      {start.data && (
        <div className="mt-3">
          <Alert tone="success">
            {start.data.status === 'done' ? `Importados ${start.data.imported}. Saltados ${start.data.skipped}.` : 'La importación está en proceso; te avisaremos al terminar.'}
          </Alert>
          {start.data.reportUrl && <a href={start.data.reportUrl} className="mt-2 inline-flex min-h-11 items-center text-sm text-ink underline">Descargar reporte de filas no importadas</a>}
        </div>
      )}
    </section>
  );
}
