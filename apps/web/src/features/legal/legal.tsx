import { Link } from '@tanstack/react-router';
import { AuthLayout } from '../../shared/ui/form';

/** E13-S01 — Casilla de aceptación. Enlaces con <a> para abrir en otra pestaña sin perder el formulario. */
export function LegalConsent({ error }: { error?: string }) {
  return (
    <div>
      <label className="flex items-start gap-3 text-sm text-auth-muted">
        <input type="checkbox" name="acceptLegal" className="mt-0.5 size-5 shrink-0 accent-honey" aria-invalid={Boolean(error)} />
        <span>
          Acepto los términos y condiciones y autorizo el tratamiento de mis datos según el{' '}
          <a href="/legal/terminos" target="_blank" rel="noopener" className="underline">documento de términos</a> y el{' '}
          <a href="/legal/privacidad" target="_blank" rel="noopener" className="underline">aviso de privacidad</a>.
        </span>
      </label>
      {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
    </div>
  );
}

export const LEGAL_REQUIRED = 'Debes aceptar los términos y el aviso de privacidad para continuar.';

/**
 * Textos legales: BORRADOR. El criterio de E13-S01 exige revisión de un abogado colombiano
 * antes de publicarlos; no se presentan como definitivos (antislop R-38).
 */
const DOCS = {
  terminos: { title: 'Términos y condiciones', version: '2026-10-06' },
  privacidad: { title: 'Aviso de privacidad y tratamiento de datos personales', version: '2026-10-06' },
} as const;

export function LegalPage({ doc }: { doc: keyof typeof DOCS }) {
  const { title, version } = DOCS[doc];
  return (
    <AuthLayout title={title} subtitle={`Versión ${version}`}>
      <div role="note" className="rounded-lg border border-auth-line bg-auth-panel p-4 text-sm text-auth-text">
        <p className="font-medium">Texto pendiente de revisión legal.</p>
        <p className="mt-2 text-auth-muted">
          Este documento lo redactará y revisará un abogado conforme a la Ley 1581 de 2012 (Habeas Data) antes del lanzamiento.
          Mientras tanto, BeeCRM está en desarrollo y no debe usarse con datos reales de clientes.
        </p>
      </div>
      <p className="mt-6 text-sm">
        <Link to="/register" className="text-auth-muted underline">Volver al registro</Link>
      </p>
    </AuthLayout>
  );
}
