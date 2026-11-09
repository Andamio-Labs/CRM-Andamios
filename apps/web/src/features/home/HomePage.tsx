import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ComponentType, type ReactNode, useState } from 'react';
import { api } from '../../shared/api';
import { authClient } from '../../shared/auth-client';
import { useRegion } from '../../shared/i18n/use-region';
import { AppShell } from '../../shared/ui/app-shell';
import { Alert } from '../../shared/ui/form';
import { AlertIcon, CalendarIcon, ChevronRightIcon, InboxIcon, KanbanIcon, MoneyIcon, TasksIcon, TrendIcon, TrophyIcon, UsersIcon, VideoIcon } from '../../shared/ui/icons';
import { Segmented } from '../../shared/ui/section';
import { firstName, type Period, PERIODS, periodRange } from './dashboard-period';
import { OnboardingChecklist } from './OnboardingChecklist';

interface Task { id: string; title: string; dueAt: string | null; dealTitle: string | null; contactName: string | null; dealId?: string | null }
interface Dashboard {
  myTasksToday: Task[];
  overdueTasks: number;
  unreadConversations: number;
  dealsWithoutNextStep: { count: number; items: { id: string; title: string; createdAt: string }[] };
  upcomingReminders: Task[];
  channelConnected: boolean;
}
interface Overview {
  newLeads: number;
  pipelineValue: number;
  won: { count: number; value: number };
  lost: { count: number; value: number };
  conversionRate: number | null;
  dealsByStage: { stageId: string; name: string; color: string; count: number; value: number }[];
}
interface Meeting { id: string; title: string; startsAt: string; endsAt: string; joinUrl: string }

/** Inicio: cifras del periodo, embudo por etapa, lo que necesita atención y lo de hoy. */
export function HomePage() {
  const { date, time, money, region } = useRegion();
  const user = authClient.useSession().data?.user;
  const [period, setPeriod] = useState<Period>('30d');
  const range = periodRange(period, region.timeZone);
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/api/v1/dashboard'), refetchInterval: 60_000, refetchIntervalInBackground: false });
  const overview = useQuery({ queryKey: ['overview', range.from, range.to], queryFn: () => api<Overview>(`/api/v1/reports/overview?from=${range.from}&to=${range.to}`) });
  const meetings = useQuery({ queryKey: ['meetings', 'upcoming'], queryFn: () => api<Meeting[]>('/api/v1/meetings?scope=upcoming') });
  const o = overview.data;
  const d = dashboard.data;
  const maxStage = Math.max(1, ...(o?.dealsByStage.map((s) => s.count) ?? [0]));

  return (
    <AppShell title="Dashboard" hideHeading wide>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted">{new Intl.DateTimeFormat(region.locale, { timeZone: region.timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</p>
          <p className="text-2xl font-semibold tracking-tight text-ink">Hola{user?.name ? `, ${firstName(user.name)}` : ''}</p>
        </div>
        <Segmented label="Periodo" options={PERIODS} value={period} onChange={setPeriod} />
      </div>

      <OnboardingChecklist />
      {d && !d.channelConnected && <ConnectBanner />}
      {(dashboard.isError || overview.isError) && <div className="mb-4"><Alert>No pudimos cargar algunas cifras. Recarga la página.</Alert></div>}

      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={MoneyIcon} label="Valor del embudo" value={o ? money(o.pipelineValue) : '…'} hint="Negocios abiertos" />
        <Kpi icon={TrophyIcon} label="Ganados" value={o ? money(o.won.value) : '…'} hint={o ? `${o.won.count} ${o.won.count === 1 ? 'negocio' : 'negocios'} en el periodo` : ' '} tone="success" />
        <Kpi icon={TrendIcon} label="Tasa de cierre" value={o ? (o.conversionRate === null ? '—' : `${Math.round(o.conversionRate * 100)} %`) : '…'} hint={o ? `${o.won.count} ganados · ${o.lost.count} perdidos` : ' '} />
        <Kpi icon={UsersIcon} label="Leads nuevos" value={o ? String(o.newLeads) : '…'} hint="Clientes creados en el periodo" />
      </dl>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel icon={KanbanIcon} title="Embudo por etapa" action={<Link to="/deals" className="text-xs text-muted hover:text-ink">Abrir embudo</Link>}>
          {o && !o.dealsByStage.length && <Empty>Crea tu embudo para ver aquí cómo avanza cada negocio.</Empty>}
          <ul className="flex flex-col gap-2.5">
            {o?.dealsByStage.map((stage) => (
              <li key={stage.stageId}>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="flex items-center gap-2 font-medium text-ink"><span className="size-2 rounded-full" style={{ background: stage.color }} />{stage.name}</span>
                  <span className="text-muted">{stage.count} · {money(stage.value)}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-raised">
                  <div className="h-full rounded-full transition-[width]" style={{ width: `${(stage.count / maxStage) * 100}%`, background: stage.color }} />
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel icon={AlertIcon} title="Necesita tu atención">
          <div className="grid gap-2">
            <Attention to="/tasks" icon={TasksIcon} label="Tareas vencidas" value={d?.overdueTasks} empty="Nada vencido" danger />
            <Attention to="/inbox" icon={InboxIcon} label="Conversaciones sin leer" value={d?.unreadConversations} empty="Todo leído" />
            <Attention to="/deals" icon={KanbanIcon} label="Negocios sin próximo paso" value={d?.dealsWithoutNextStep.count} empty="Todos tienen una tarea" />
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel icon={TasksIcon} title="Mis tareas de hoy" action={<Link to="/tasks" className="text-xs text-muted hover:text-ink">Mis tareas</Link>}>
          {d && !d.myTasksToday.length && <Empty>Para hoy no tienes tareas pendientes.</Empty>}
          <ul className="divide-y divide-line">
            {d?.myTasksToday.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate text-ink">{task.title}</span>
                  {(task.dealTitle || task.contactName) && <span className="block truncate text-xs text-muted">{task.dealTitle ?? task.contactName}</span>}
                </span>
                {task.dueAt && <span className={`shrink-0 text-xs ${Date.parse(task.dueAt) < Date.now() ? 'font-semibold text-danger' : 'text-muted'}`}>{date(task.dueAt) === date(new Date()) ? time(task.dueAt) : `${date(task.dueAt)} ${time(task.dueAt)}`}</span>}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel icon={VideoIcon} title="Próximas reuniones" action={<Link to="/meetings" className="text-xs text-muted hover:text-ink">Reuniones</Link>}>
          {meetings.data && !meetings.data.length && <Empty>No tienes reuniones próximas.</Empty>}
          <ul className="divide-y divide-line">
            {meetings.data?.slice(0, 4).map((m) => {
              const live = Date.parse(m.startsAt) <= Date.now();
              return (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link to="/meetings" search={{ m: m.id }} className="min-w-0">
                    <span className="block truncate text-ink">{m.title}</span>
                    <span className="block text-xs text-muted">{live ? 'En curso' : `${date(m.startsAt)} · ${time(m.startsAt)}`}</span>
                  </Link>
                  {live && <a href={m.joinUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-md bg-honey px-2.5 py-1 text-xs font-semibold text-on-honey">Entrar</a>}
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel icon={CalendarIcon} title="Sin próximo paso" action={<Link to="/deals" className="text-xs text-muted hover:text-ink">Embudo</Link>}>
          {d && !d.dealsWithoutNextStep.items.length && <Empty>Todos los negocios abiertos tienen una tarea pendiente.</Empty>}
          <ul className="divide-y divide-line">
            {d?.dealsWithoutNextStep.items.slice(0, 5).map((deal) => (
              <li key={deal.id}>
                <Link to="/deals" search={{ deal: deal.id, tab: 'tareas' }} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="truncate text-ink">{deal.title}</span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted">desde {date(deal.createdAt)} <ChevronRightIcon size={12} /></span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </AppShell>
  );
}

function Kpi({ icon: Icon, label, value, hint, tone }: { icon: ComponentType<{ size?: number }>; label: string; value: string; hint: string; tone?: 'success' }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <dt className="flex items-center gap-2 text-xs font-medium text-muted">
        <span className={`grid size-7 place-items-center rounded-lg ${tone === 'success' ? 'bg-success-soft text-success' : 'bg-honey-soft text-ink'}`}><Icon size={15} /></span>
        {label}
      </dt>
      <dd className="mt-3 text-2xl font-semibold tracking-tight text-ink">{value}</dd>
      <dd className="mt-0.5 text-xs text-muted">{hint}</dd>
    </div>
  );
}

function Panel({ icon: Icon, title, action, children }: { icon: ComponentType<{ size?: number }>; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><span className="grid size-7 place-items-center rounded-lg bg-honey-soft text-ink"><Icon size={15} /></span>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Attention({ to, icon: Icon, label, value, empty, danger }: { to: string; icon: ComponentType<{ size?: number }>; label: string; value: number | undefined; empty: string; danger?: boolean }) {
  const hot = Boolean(value);
  return (
    <Link to={to as '/'} className="flex items-center gap-3 rounded-xl border border-line bg-canvas px-3 py-2.5 transition hover:border-honey/60">
      <span className={`grid size-8 place-items-center rounded-lg ${hot && danger ? 'bg-danger-soft text-danger' : 'bg-raised text-muted'}`}><Icon size={15} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted">{label}</span>
        <span className="block text-xs text-ink">{value === undefined ? '…' : hot ? '' : empty}</span>
      </span>
      {hot && <span className={`text-lg font-semibold ${danger ? 'text-danger' : 'text-ink'}`}>{value}</span>}
      <ChevronRightIcon size={14} className="text-muted" />
    </Link>
  );
}

function ConnectBanner() {
  return (
    <section className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-honey/50 bg-honey-soft px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-xl bg-honey text-on-honey"><InboxIcon size={17} /></span>
        <div>
          <h2 className="text-sm font-semibold text-ink">Conecta WhatsApp y tus clientes llegarán solos</h2>
          <p className="mt-0.5 text-xs text-muted">Cada conversación nueva crea el cliente y su negocio en el embudo.</p>
        </div>
      </div>
      <Link to="/settings" search={{ tab: 'canales' }} className="rounded-lg bg-surface px-3 py-2 text-xs font-semibold text-ink shadow-sm">Conectar canal</Link>
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="py-3 text-xs text-muted">{children}</p>;
