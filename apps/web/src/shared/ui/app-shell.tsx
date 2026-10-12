import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { api } from '../api';
import { authClient } from '../auth-client';
import { initials } from '../initials';
import { useRegion } from '../i18n/use-region';
import type { MessageKey } from '../i18n/messages';
import { useTheme } from '../use-theme';
import { NotificationsBell } from './notifications-bell';
import { ProfileMenu } from './profile-menu';
import { AccountBanner, CommandPalette } from './shell-widgets';

type NavTo = '/' | '/tasks' | '/meetings' | '/reports' | '/deals' | '/inbox' | '/contacts' | '/team' | '/settings';

const MAIN_NAV: { to: NavTo; label: MessageKey }[] = [
  { to: '/', label: 'nav.home' },
  { to: '/deals', label: 'nav.deals' },
  { to: '/inbox', label: 'nav.inbox' },
  { to: '/contacts', label: 'nav.contacts' },
  { to: '/tasks', label: 'nav.tasks' },
  { to: '/meetings', label: 'nav.meetings' },
  { to: '/reports', label: 'nav.reports' },
];

const TEAM_NAV: { to: NavTo; label: MessageKey }[] = [
  { to: '/team', label: 'nav.team' },
  { to: '/settings', label: 'nav.settings' },
];

const NAV_ICONS: Record<NavTo, string> = {
  '/': '⌂',
  '/deals': '▣',
  '/inbox': '▤',
  '/contacts': '♙',
  '/tasks': '☑',
  '/meetings': '◉',
  '/reports': '▥',
  '/team': '♧',
  '/settings': '⚙',
};

function Logo() {
  return (
    <div className="flex items-center gap-2 font-bold tracking-tight text-ink">
      <span className="grid size-7 place-items-center rounded-md bg-honey text-sm text-ink"><span className="bee-mark" aria-hidden="true"><span /><span /></span></span>
      <span>BeeCRM</span>
    </div>
  );
}

/**
 * Marco de las pantallas autenticadas: sidebar y rail derecho (perfil, campana, equipo) en desktop,
 * barra superior en móvil. `hideHeading`: la página trae su propio encabezado (el título queda en la miga).
 */
export function AppShell({ title, subtitle, wide, hideHeading, children }: { title: string; subtitle?: string; wide?: boolean; hideHeading?: boolean; children: ReactNode }) {
  const width = wide ? 'max-w-none' : 'max-w-3xl';
  const navigate = useNavigate();
  const { t } = useRegion();
  const { theme, toggleTheme } = useTheme();
  async function signOut() {
    await authClient.signOut();
    navigate({ to: '/login' });
  }
  return (
    <div className="min-h-dvh bg-canvas md:flex">
      <aside className="sticky top-0 hidden h-dvh w-[12rem] shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="flex h-12 items-center justify-between border-b border-line px-3"><Logo /><span className="text-xs text-muted">⌄</span></div>
        <div className="border-b border-line px-2 py-2"><CompanySwitcher /></div>
        <div className="flex gap-1 border-b border-line p-2">
          <CommandPalette label="Buscar secciones..." />
          <span aria-hidden className="grid min-h-9 min-w-9 place-items-center rounded-md border border-line text-xs text-muted">▦</span>
        </div>
        <nav aria-label="Principal" className="flex flex-col gap-0.5 px-2 py-2">
          <NavItems items={MAIN_NAV} t={t} />
        </nav>
        <p className="px-4 pb-1 pt-3 text-[10px] font-bold uppercase tracking-widest text-muted">Equipo</p>
        <nav aria-label="Equipo" className="flex flex-col gap-0.5 px-2">
          <NavItems items={TEAM_NAV} t={t} />
        </nav>
        <div className="mt-auto border-t border-line p-2">
          <button onClick={signOut} className="flex min-h-11 w-full items-center rounded-lg px-3 text-sm text-muted hover:bg-canvas hover:text-danger">
            {t('nav.signOut')}
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
          <div className="flex h-10 items-center gap-2 px-3 text-xs">
            <div className="md:hidden"><Logo /></div>
            <span className="hidden text-muted md:inline">☰</span>
            <span className="hidden text-muted md:inline">⌂ Inicio</span>
            <span className="hidden text-muted md:inline">›</span>
            <span className="hidden font-medium text-ink md:inline">{title}</span>
            <div className="ml-auto flex items-center gap-1">
              <CommandPalette />
              <div className="md:hidden"><NotificationsBell /></div>
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
                title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
                className="grid min-h-10 min-w-10 place-items-center rounded-lg border border-line text-base text-muted transition hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey"
              >
                <span aria-hidden>{theme === 'dark' ? '☀' : '☾'}</span>
              </button>
              {/* En desktop el avatar con tu estado vive en el rail derecho. */}
              <div className="md:hidden"><ProfileMenu onSignOut={signOut} /></div>
            </div>
          </div>
          <nav aria-label="Principal" className="flex min-w-0 max-w-full gap-1 overflow-x-auto overscroll-x-contain px-3 pb-2 md:hidden">
            {[...MAIN_NAV, ...TEAM_NAV].map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-lg px-3 text-sm text-muted hover:text-ink"
                activeProps={{ className: 'bg-honey-soft font-medium text-ink' }}
                activeOptions={{ exact: item.to === '/' }}
              >
                {t(item.label)}
              </Link>
            ))}
          </nav>
        </header>
        <main className={`mx-auto ${width} px-3 py-4 sm:px-5 sm:py-5`}>
          <AccountBanner />
          {hideHeading ? <h1 className="sr-only">{title}</h1> : (
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
                {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
              </div>
            </div>
          )}
          <div>{children}</div>
        </main>
      </div>
      <RightRail onSignOut={signOut} />
    </div>
  );
}

/** Empresa activa; lleva a "Configuración de empresas" para cambiar, crear o unirse a otra. */
function CompanySwitcher() {
  const companies = useQuery({ queryKey: ['my-companies'], queryFn: () => api<{ id: string; name: string; active: boolean }[]>('/api/v1/my-companies'), staleTime: 60_000 });
  const active = companies.data?.find((c) => c.active);
  return (
    <Link to="/profile" search={{ tab: 'empresa' }} title="Cambiar de empresa" className="flex min-h-10 items-center gap-2 rounded-full border border-line bg-canvas px-1.5 text-xs transition hover:border-honey/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey">
      <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-honey-soft text-[10px] font-bold text-ink ring-1 ring-honey/50">{active ? initials(active.name) : '…'}</span>
      <span className="min-w-0 flex-1 truncate font-semibold text-ink">{active?.name ?? 'Tu empresa'}</span>
      <svg aria-hidden viewBox="0 0 24 24" className="mr-1 size-3.5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" /></svg>
    </Link>
  );
}

/** Rail derecho de desktop: tu avatar con tu estado (E01-S09; desde ahí, tu perfil), la campana y el equipo. */
function RightRail({ onSignOut }: { onSignOut: () => void }) {
  return (
    <aside aria-label="Tu cuenta" className="sticky top-0 hidden h-dvh w-14 shrink-0 flex-col items-center gap-3 border-l border-line bg-surface py-2.5 md:flex">
      <ProfileMenu onSignOut={onSignOut} placement="rail" />
      <NotificationsBell placement="rail" />
      <Link to="/team" aria-label="Equipo" title="Equipo" className="grid min-h-10 min-w-10 place-items-center rounded-lg text-ink transition hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey" activeProps={{ className: 'bg-honey-soft' }}>
        <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0" /><path d="M16 4a4 4 0 0 1 0 8" /><path d="M22 21a7 7 0 0 0-4-6.3" /></svg>
      </Link>
    </aside>
  );
}

function NavItems({ items, t }: { items: { to: NavTo; label: MessageKey }[]; t: (key: MessageKey) => string }) {
  return (
    <>
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs text-muted hover:bg-canvas hover:text-ink"
          activeProps={{ className: 'bg-honey-soft font-semibold text-ink' }}
          activeOptions={{ exact: item.to === '/' }}
        >
          <span className="w-4 text-center text-sm">{NAV_ICONS[item.to]}</span>
          <span>{t(item.label)}</span>
        </Link>
      ))}
    </>
  );
}
