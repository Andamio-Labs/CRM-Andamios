import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';

export function Field({ label, error, auth = false, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; auth?: boolean }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-auth-muted">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`h-11 rounded-lg border px-3 outline-none transition focus:border-honey focus:ring-2 focus:ring-honey/30 aria-[invalid=true]:border-danger ${auth ? 'border-auth-line bg-auth-input text-auth-text placeholder:text-auth-muted' : 'border-line bg-surface text-ink'}`}
        {...input}
      />
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function Button({ children, loading, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      disabled={loading || props.disabled}
      className={`h-11 rounded-lg bg-honey px-4 font-semibold text-ink transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey focus-visible:ring-offset-2 focus-visible:ring-offset-auth-panel active:scale-[0.98] disabled:opacity-60 ${className ?? ''}`}
      {...props}
    >
      {loading ? 'Un momento…' : children}
    </button>
  );
}

export function Alert({ children, tone = 'danger' }: { children: ReactNode; tone?: 'danger' | 'success' }) {
  const styles = tone === 'danger' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-success/30 bg-success/10 text-success';
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-sm ${styles}`}>
      {children}
    </div>
  );
}

export function AuthLayout({ title, subtitle, children }: { title: ReactNode; subtitle?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-auth-canvas px-4 py-6 text-auth-text sm:py-10">
      <div className="w-full max-w-md rounded-3xl border border-auth-line bg-auth-panel px-7 py-7 shadow-2xl sm:px-8 sm:py-8">
        <div className="mb-7 flex items-center justify-end gap-4 text-xs text-auth-muted">
          <span className="inline-flex items-center gap-1.5" aria-label="Idioma: español"><span aria-hidden>◎</span> ES</span>
          <span aria-hidden className="text-sm">☾</span>
        </div>
        <div className="text-center">
          <div className="mx-auto mb-5 grid size-12 place-items-center rounded-xl bg-honey text-auth-canvas" aria-label="BeeCRM">
            <span className="bee-mark" aria-hidden="true"><span /><span /></span>
          </div>
          <h1 className="text-[1.7rem] font-medium leading-tight tracking-tight text-auth-text">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-auth-muted">{subtitle}</p>}
        </div>
        <div className="mt-7">{children}</div>
        <p className="mt-8 text-center text-xs text-auth-muted">© 2026 BeeCRM. Todos los derechos reservados.</p>
      </div>
    </main>
  );
}
