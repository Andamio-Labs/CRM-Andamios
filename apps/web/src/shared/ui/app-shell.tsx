import { Link, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { authClient } from '../auth-client';
import { useRegion } from '../i18n/use-region';
import type { MessageKey } from '../i18n/messages';
import { useTheme } from '../use-theme';
import { AccountBanner, CommandPalette, NotificationsBell } from './shell-widgets';

type NavTo = '/' | '/tasks' | '/reports' | '/deals' | '/inbox' | '/contacts' | '/team' | '/settings';

const MAIN_NAV: { to: NavTo; label: MessageKey }[] = [
  { to: '/', label: 'nav.home' },
  { to: '/deals', label: 'nav.deals' },
  { to: '/inbox', label: 'nav.inbox' },
  { to: '/contacts', label: 'nav.contacts' },
  { to: '/tasks', label: 'nav.tasks' },
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

/** Marco de las pantallas autenticadas: sidebar en desktop, barra superior en móvil. */
export function AppShell({ title, subtitle, wide, children }: { title: string; subtitle?: string; wide?: boolean; children: ReactNode }) {
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
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs text-muted">
          <span className="grid size-6 place-items-center rounded-full bg-honey-soft font-semibold text-ink">A</span>
          <span className="truncate font-medium text-ink">Andamion</span>
          <span className="ml-auto">⌄</span>
        </div>
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
              <NotificationsBell />
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
                title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
                className="grid min-h-10 min-w-10 place-items-center rounded-lg border border-line text-base text-muted transition hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey"
              >
                <span aria-hidden>{theme === 'dark' ? '☀' : '☾'}</span>
              </button>
              <button onClick={signOut} className="inline-flex min-h-11 items-center px-2 text-sm text-muted underline md:hidden">
                {t('nav.signOut')}
              </button>
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
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
              {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
            </div>
          </div>
          <div>{children}</div>
        </main>
      </div>
    </div>
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
