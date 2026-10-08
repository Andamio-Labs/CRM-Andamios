/**
 * Enlaces que vienen del servidor (avisos, onboarding) → props de <Link>. TanStack Router espera la ruta
 * en `to` y los parámetros en `search`; "/inbox?c=1" entero en `to` no abre la conversación.
 * Solo rutas internas: un enlace externo o protocol-relative lleva al inicio.
 */
export function linkTarget(link: string | null | undefined): { to: string; search: Record<string, string> } {
  if (!link || !link.startsWith('/') || link.startsWith('//')) return { to: '/', search: {} };
  const url = new URL(link, 'http://local');
  return { to: url.pathname, search: Object.fromEntries(url.searchParams) };
}
