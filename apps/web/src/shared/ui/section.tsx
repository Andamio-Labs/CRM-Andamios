import type { ReactNode } from 'react';
import { useId } from 'react';

/**
 * Primitivos del sistema de diseño (DESIGN.md): card blanca con borde fino y sombra mínima, encabezado
 * con ícono en tile miel suave, CTA miel, filtros con el activo en miel y badges de fondo suave.
 */
export const primaryButton = 'inline-flex min-h-10 items-center justify-center gap-1 rounded-lg bg-honey px-4 text-xs font-semibold text-ink shadow-sm transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey focus-visible:ring-offset-2 disabled:opacity-60';
export const secondaryButton = 'inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-line bg-surface px-4 text-xs font-semibold text-ink transition hover:bg-honey-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey disabled:opacity-60';
export const dangerButton = 'inline-flex min-h-10 items-center justify-center rounded-lg bg-danger px-4 text-xs font-semibold text-surface shadow-sm transition hover:brightness-95 disabled:opacity-60';
export const linkButton = 'inline-flex min-h-10 items-center px-1 text-xs font-medium text-ink underline-offset-2 hover:underline';
export const labelClass = 'flex flex-col gap-1.5 text-xs font-semibold text-muted';
export const inputClass = 'h-10 rounded-lg border border-line bg-surface px-3 text-sm font-normal text-ink outline-none transition focus:border-honey focus:ring-2 focus:ring-honey/30';
export const textareaClass = 'rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal text-ink outline-none transition focus:border-honey focus:ring-2 focus:ring-honey/30';
export const tableHeadClass = 'border-b border-line bg-honey-soft/30 text-[10px] uppercase tracking-wide text-muted';

export function IconTile({ children, size = 'sm' }: { children: ReactNode; size?: 'sm' | 'md' }) {
  return <span aria-hidden className={`grid shrink-0 place-items-center rounded-md bg-honey-soft text-ink ${size === 'md' ? 'size-10 rounded-lg text-xl' : 'size-7 text-sm'}`}>{children}</span>;
}

/** Card de sección: ícono + título + bajada + acción opcional a la derecha. */
export function SettingsSection({ icon, title, description, action, tone = 'default', children }: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tone?: 'default' | 'danger';
  children?: ReactNode;
}) {
  const id = useId();
  const border = tone === 'danger' ? 'border-danger/40' : 'border-line';
  return (
    <section aria-labelledby={id} className={`rounded-xl border ${border} bg-surface p-4 shadow-sm`}>
      <div className="flex flex-wrap items-start gap-3">
        <IconTile>{icon}</IconTile>
        <div className="min-w-0 flex-1">
          <h2 id={id} className={`text-sm font-semibold ${tone === 'danger' ? 'text-danger' : 'text-ink'}`}>{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </section>
  );
}

export type BadgeTone = 'neutral' | 'honey' | 'success' | 'danger' | 'info';
const BADGE: Record<BadgeTone, string> = {
  neutral: 'bg-raised text-muted',
  honey: 'bg-honey-soft text-ink',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-ink',
};

export function Badge({ tone = 'neutral', children, title }: { tone?: BadgeTone; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${BADGE[tone]}`}>{children}</span>;
}

/** Filtros y alternadores de vista: el activo va en miel. */
export function Segmented<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1 shadow-sm">
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`min-h-9 rounded-lg px-3 text-xs ${value === key ? 'bg-honey font-semibold text-ink' : 'text-muted hover:bg-canvas hover:text-ink'}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Ninguna pantalla en blanco: ícono + mensaje + acción. */
export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface/60 px-4 py-6 text-center text-xs text-muted">
      <span aria-hidden className="mx-auto mb-2 grid size-7 place-items-center rounded-full bg-honey-soft text-ink">{icon}</span>
      <strong className="block font-semibold text-ink">{title}</strong>
      {children && <span className="mt-1 block">{children}</span>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-sm">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tracking-tight text-ink">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-muted">{hint}</dd>}
    </div>
  );
}

/** Barra de progreso (cuota, uso). Al 80 % pasa a aviso y al 100 % a peligro. */
export function Meter({ percent, label }: { percent: number; label: string }) {
  const tone = percent >= 100 ? 'bg-danger' : percent >= 80 ? 'bg-honey' : 'bg-ink/70';
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(percent, 100)} className="h-2 overflow-hidden rounded-full bg-raised">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  );
}
