import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import { useRegion } from '../../shared/i18n/use-region';
import { AppShell } from '../../shared/ui/app-shell';
import { Alert } from '../../shared/ui/form';
import { OnboardingChecklist } from './OnboardingChecklist';

interface Task { id: string; title: string; dueAt: string | null; dealTitle: string | null; contactName: string | null }
interface Dashboard {
  myTasksToday: Task[];
  overdueTasks: number;
  unreadConversations: number;
  dealsWithoutNextStep: { count: number; items: { id: string; title: string; createdAt: string }[] };
  upcomingReminders: Task[];
  channelConnected: boolean;
}

/** Inicio con la densidad de la referencia, sin cambiar los datos que alimentan la pantalla. */
export function HomePage() {
  const { date, time } = useRegion();
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/api/v1/dashboard'), refetchInterval: 60_000, refetchIntervalInBackground: false });

  return (
    <AppShell title="Dashboard" subtitle="Lo importante para tu equipo, en un solo lugar." wide>
      <OnboardingChecklist />
      {dashboard.isPending && <p className="text-sm text-muted">Cargando dashboard…</p>}
      {dashboard.isError && <Alert>No pudimos cargar el dashboard. Recarga la página.</Alert>}
      {dashboard.data && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-full bg-honey text-ink">⌁</span>
              <strong className="text-sm text-ink">Mi resumen</strong>
              <span className="text-xs text-muted">{date(new Date().toISOString())}</span>
            </div>
            <div className="flex gap-1 rounded-lg border border-line bg-surface p-1 text-xs">
              <span className="rounded-md px-3 py-1.5 text-muted">7 días</span>
              <span className="rounded-md px-3 py-1.5 text-muted">14 días</span>
              <span className="rounded-md bg-honey px-3 py-1.5 font-semibold text-ink">Mes</span>
              <span className="hidden rounded-md px-3 py-1.5 text-muted sm:inline">3 meses</span>
            </div>
          </div>

          {!dashboard.data.channelConnected && <ConnectBanner />}

          <Onboarding />

          <section className="rounded-xl border border-line bg-surface px-4 py-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3"><span className="grid size-7 place-items-center rounded-md bg-honey-soft text-sm text-ink">▣</span><div><h2 className="text-sm font-semibold text-ink">Mis tareas de hoy</h2><p className="text-xs text-muted">{dashboard.data.myTasksToday.length ? `${dashboard.data.myTasksToday.length} tareas pendientes` : 'Para hoy no hay tareas nuevas'}</p></div></div>
              <Link to="/tasks" className="text-xs text-muted underline">Ver todas →</Link>
            </div>
            {dashboard.data.myTasksToday.length > 0 && <ul className="mt-3 divide-y divide-line border-t border-line">{dashboard.data.myTasksToday.map((task) => <li key={task.id} className="flex justify-between gap-3 py-2 text-sm"><span className="truncate text-ink">{task.title}</span><span className="shrink-0 text-xs text-muted">{task.dueAt ? time(task.dueAt) : ''}</span></li>)}</ul>}
          </section>

          <section className="min-h-36 rounded-xl border border-line bg-surface p-5 shadow-sm">
            <div className="flex min-h-24 flex-col items-center justify-center text-center"><span className="text-2xl text-honey">⌁</span><h2 className="mt-2 text-sm font-semibold text-ink">Aquí aparecerán tus cifras y tu embudo</h2><p className="mt-1 max-w-md text-xs text-muted">Los negocios, ingresos y analíticas se completarán cuando conectes un canal y empieces a trabajar con tus clientes.</p><Link to="/deals" className="mt-3 text-xs font-medium text-ink underline">Abrir negocios</Link></div>
          </section>

          <section className="rounded-xl border border-line bg-surface p-4 shadow-sm">
            <div className="flex items-center gap-3"><span className="grid size-7 place-items-center rounded-md bg-danger-soft text-sm text-danger">!</span><div><h2 className="text-sm font-semibold text-ink">Lo que necesita tu atención</h2><p className="text-xs text-muted">Revisa estos pendientes del equipo</p></div></div>
            <div className="mt-3 grid gap-3 md:grid-cols-3"><Counter to="/tasks" label="Tareas vencidas" value={dashboard.data.overdueTasks} empty="Nada vencido" danger /><Counter to="/inbox" label="Mensajes sin leer" value={dashboard.data.unreadConversations} empty="Todo leído" /><Counter to="/deals" label="Sin próximo paso" value={dashboard.data.dealsWithoutNextStep.count} empty="Todo está al día" /></div>
          </section>

          <div className="grid gap-4 md:grid-cols-2"><Block title="Negocios sin próximo paso" action={<Link to="/deals" className="text-xs text-muted underline">Ir al embudo</Link>}>{dashboard.data.dealsWithoutNextStep.items.length === 0 ? <Empty>Todos los negocios abiertos tienen una tarea pendiente.</Empty> : <ul className="divide-y divide-line">{dashboard.data.dealsWithoutNextStep.items.map((deal) => <li key={deal.id} className="flex justify-between gap-2 py-2 text-sm"><span className="truncate text-ink">{deal.title}</span><span className="text-xs text-muted">desde {date(deal.createdAt)}</span></li>)}</ul>}</Block><Block title="Próximos recordatorios" action={<Link to="/tasks" className="text-xs text-muted underline">Crear</Link>}>{dashboard.data.upcomingReminders.length === 0 ? <Empty>No hay recordatorios próximos.</Empty> : <ul className="divide-y divide-line">{dashboard.data.upcomingReminders.map((task) => <li key={task.id} className="flex justify-between gap-2 py-2 text-sm"><span className="truncate text-ink">{task.title}</span><span className="text-xs text-muted">{task.dueAt ? date(task.dueAt) : ''}</span></li>)}</ul>}</Block></div>
        </div>
      )}
    </AppShell>
  );
}

function ConnectBanner() {
  return <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-honey/50 bg-honey-soft px-4 py-3"><div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-md bg-honey text-ink">⌁</span><div><h2 className="text-sm font-semibold text-ink">Conecta un canal y tus clientes aparecerán aquí</h2><p className="mt-0.5 text-xs text-muted">Conecta WhatsApp para empezar a recibir conversaciones y organizar tus negocios.</p></div></div><Link to="/settings" search={{ tab: 'canales' }} className="rounded-lg bg-surface px-3 py-2 text-xs font-semibold text-ink shadow-sm">Conectar canal</Link></section>;
}

function Onboarding() {
  const steps = [['Ver el embudo', '/deals'], ['Abrir tus chats', '/inbox'], ['Encontrar un cliente', '/contacts'], ['Crear una tarea', '/tasks']];
  return <section className="rounded-xl border border-line bg-surface p-4 shadow-sm"><div className="flex items-center gap-3"><span className="grid size-7 place-items-center rounded-md bg-honey-soft text-sm text-ink">♧</span><div><h2 className="text-sm font-semibold text-ink">Primeros pasos en BeeCRM</h2><p className="text-xs text-muted">Un recorrido rápido para conocer tus espacios de trabajo.</p></div></div><div className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-4">{steps.map(([label, to], index) => <Link key={label} to={to as '/'} className="flex min-h-14 items-center gap-2 rounded-lg border border-line px-3 hover:border-honey"><span className="grid size-5 place-items-center rounded-full border border-line text-[10px] text-muted">{index + 1}</span><span className="text-xs font-medium text-ink">{label}</span><span className="ml-auto text-muted">›</span></Link>)}</div></section>;
}

function Counter({ to, label, value, empty, danger }: { to: string; label: string; value: number; empty: string; danger?: boolean }) {
  return <Link to={to as '/'} className="rounded-lg border border-line bg-canvas p-3 transition hover:border-honey/60"><p className="text-xs text-muted">{label}</p><p className={`mt-1 text-lg font-semibold ${value && danger ? 'text-danger' : 'text-ink'}`}>{value || '0'}</p>{!value && <p className="text-xs text-muted">{empty}</p>}</Link>;
}

function Block({ title, action, children }: { title: string; action: ReactNode; children: ReactNode }) {
  return <section className="rounded-xl border border-line bg-surface p-4 shadow-sm"><div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold text-ink">{title}</h2>{action}</div>{children}</section>;
}

const Empty = ({ children }: { children: ReactNode }) => <p className="py-3 text-xs text-muted">{children}</p>;
