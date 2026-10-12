import { Link, useSearch } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { AppShell } from '../../shared/ui/app-shell';
import { CompaniesTab } from './CompaniesTab';
import { NotificationSettings } from './NotificationSettings';
import { ProfileOverview } from './ProfileOverview';
import { PROFILE_TABS, type ProfileTab, profileTabFrom } from './profile-tabs';

const TAB_ICONS: Record<ProfileTab, ReactNode> = {
  perfil: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  empresa: <><path d="M3 21h18" /><path d="M5 21V10l7-5 7 5v11" /><path d="M9 21v-6h6v6" /></>,
  notificaciones: <><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
};

const TAB_CONTENT: Record<ProfileTab, () => ReactNode> = {
  perfil: () => <ProfileOverview />,
  empresa: () => <CompaniesTab />,
  notificaciones: () => <NotificationSettings />,
};

/** Lo personal: tus datos, tus empresas y tus notificaciones. La tuerca de la campana abre `?tab=notificaciones`. */
export function ProfilePage() {
  const search = useSearch({ from: '/profile' });
  const tab = profileTabFrom(search.tab);
  const Content = TAB_CONTENT[tab];
  return (
    <AppShell title="Perfil" wide hideHeading>
      <nav aria-label="Secciones del perfil" className="flex overflow-x-auto border-b border-line">
        {PROFILE_TABS.map((t) => {
          const active = t.id === tab;
          return (
            <Link
              key={t.id}
              to="/profile"
              search={{ tab: t.id }}
              aria-current={active ? 'page' : undefined}
              className={`-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-6 text-sm transition sm:px-8 ${active ? 'border-honey bg-gradient-to-b from-transparent to-honey-soft text-honey-ink' : 'border-transparent text-ink hover:text-honey-ink'}`}
            >
              <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{TAB_ICONS[t.id]}</svg>
              {t.label}
            </Link>
          );
        })}
      </nav>
      <div className="pt-5"><Content /></div>
    </AppShell>
  );
}
