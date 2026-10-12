import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useRef, useState } from 'react';
import { api, upload } from '../../shared/api';
import { authClient } from '../../shared/auth-client';
import { useRegion } from '../../shared/i18n/use-region';
import { initials } from '../../shared/initials';
import { linkTarget } from '../../shared/link-target';
import { Alert } from '../../shared/ui/form';
import { ROLE_LABELS, type TeamRole } from '../team/roles';
import { eventLabel, shortId, splitName, whenLabel } from './profile-format';

export interface Profile {
  id: string; name: string; email: string; emailVerified: boolean; memberSince: string; companyName: string; role: TeamRole;
  position: string | null; phone: string | null; address: string | null; bio: string | null; avatarUrl: string | null;
}
interface Activity {
  deals: { open: number; wonThisMonth: number };
  tasks: { open: number; today: number; overdue: number };
  reminders: { today: number; overdue: number };
  conversations: { open: number; unread: number };
  recent: { id: number; type: string; dealId: string; dealTitle: string; createdAt: string }[];
}
export interface MyCompany { id: string; name: string; role: TeamRole; active: boolean; joinCode: string | null; currency: string; createdAt: string; crmConfigured: boolean; funnelCreated: boolean }

type Editable = 'position' | 'phone' | 'address' | 'bio';

export const PROFILE_KEY = ['me', 'profile'];
export const COMPANIES_KEY = ['my-companies'];

const I = {
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />,
  pin: <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  id: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M15 8h3M15 12h3M6 16h6" /></>,
  camera: <><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" /><circle cx="12" cy="13" r="3" /></>,
  crown: <path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zM5 20h14" />,
  building: <><path d="M3 21h18" /><path d="M5 21V10l7-5 7 5v11" /><path d="M9 21v-6h6v6" /></>,
  check: <><circle cx="12" cy="12" r="10" /><path d="m8 12 3 3 5-6" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
  chart: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="m7 15 3-3 3 2 4-5" /></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /></>,
  task: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="m8 12 3 3 5-6" /></>,
  bell: <><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  chevron: <path d="m9 18 6-6-6-6" />,
  x: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
};

export function Svg({ children, className = 'size-4' }: { children: ReactNode; className?: string }) {
  return <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}

export const card = 'rounded-2xl border border-line bg-surface';

export function CardHeader({ icon, title, subtitle, action }: { icon: ReactNode; title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg border border-line text-muted"><Svg>{icon}</Svg></span>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const fieldLabel = 'mb-1.5 block text-xs font-semibold text-ink';
const fieldBox = 'flex h-10 items-center gap-2 rounded-lg border border-line bg-canvas px-3 text-sm text-ink transition focus-within:border-honey focus-within:ring-2 focus-within:ring-honey/30';

/** Pestaña Perfil: tarjeta principal, datos personales, "Sobre mí", actividad y empresas. */
export function ProfileOverview() {
  const profile = useQuery({ queryKey: PROFILE_KEY, queryFn: () => api<Profile>('/api/v1/me/profile') });
  if (profile.isPending) return <p className="text-sm text-muted">Cargando…</p>;
  if (profile.isError) return <Alert>No pudimos cargar tu perfil.</Alert>;
  const me = profile.data;
  return (
    <div className="flex flex-col gap-5">
      <Hero me={me} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,27rem)]">
        <div className="flex min-w-0 flex-col gap-5">
          <PersonalInfo me={me} />
          <AboutMe me={me} />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <MyActivity companyName={me.companyName} />
          <MyCompanies />
        </div>
      </div>
    </div>
  );
}

function Hero({ me }: { me: Profile }) {
  const queryClient = useQueryClient();
  const { region } = useRegion();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const setAvatar = useMutation({
    mutationFn: (file: File) => { const body = new FormData(); body.append('file', file); return upload<{ avatarUrl: string }>('/api/v1/me/avatar', body); },
    onMutate: () => setError(null),
    onSuccess: ({ avatarUrl }) => queryClient.setQueryData<Profile>(PROFILE_KEY, (p) => (p ? { ...p, avatarUrl } : p)),
    onError: () => setError('No pudimos subir la foto. Usa una imagen PNG, JPG o WebP de hasta 2 MB.'),
  });
  const removeAvatar = useMutation({
    mutationFn: () => api('/api/v1/me/avatar', { method: 'DELETE' }),
    onSuccess: () => queryClient.setQueryData<Profile>(PROFILE_KEY, (p) => (p ? { ...p, avatarUrl: null } : p)),
  });
  const since = new Intl.DateTimeFormat(region.locale, { timeZone: region.timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(me.memberSince));

  return (
    <section aria-label="Tu perfil" className={`${card} relative overflow-hidden`}>
      <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-honey via-honey to-honey/30" />
      <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
        <div className="relative size-24 shrink-0">
          {me.avatarUrl
            ? <img src={me.avatarUrl} alt="" className="size-24 rounded-full object-cover" />
            : <span aria-hidden className="grid size-24 place-items-center rounded-full bg-honey text-3xl font-bold text-on-honey">{initials(me.name)}</span>}
          <button type="button" onClick={() => input.current?.click()} disabled={setAvatar.isPending} aria-label="Cambiar foto" title="Cambiar foto" className="absolute bottom-0 right-0 grid size-8 place-items-center rounded-full border border-line bg-surface text-ink shadow transition hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey">
            <Svg className="size-3.5">{I.camera}</Svg>
          </button>
          {me.avatarUrl && (
            <button type="button" onClick={() => removeAvatar.mutate()} aria-label="Quitar foto" title="Quitar foto" className="absolute right-0 top-0 grid size-6 place-items-center rounded-full border border-line bg-surface text-muted shadow transition hover:text-danger">
              <Svg className="size-3">{I.x}</Svg>
            </button>
          )}
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; if (f) setAvatar.mutate(f); e.target.value = ''; }} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-2xl font-bold tracking-tight text-ink">{me.name}</h2>
          <p className="mt-0.5 text-sm text-muted">{me.position ?? 'Sin cargo definido'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-honey-soft px-2.5 py-1 text-xs font-semibold text-honey-ink">
              {me.role === 'owner' && <Svg className="size-3.5">{I.crown}</Svg>}{ROLE_LABELS[me.role]}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-raised px-2.5 py-1 text-xs font-semibold text-ink"><Svg className="size-3.5">{I.building}</Svg>{me.companyName}</span>
            {me.emailVerified && <span className="inline-flex items-center gap-1.5 rounded-md bg-success-soft px-2.5 py-1 text-xs font-semibold text-success"><Svg className="size-3.5">{I.check}</Svg>Verificado</span>}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted">
            <span className="inline-flex min-w-0 items-center gap-1.5"><Svg className="size-3.5 shrink-0">{I.mail}</Svg><span className="truncate">{me.email}</span></span>
            <span className="inline-flex items-center gap-1.5"><Svg className="size-3.5">{I.calendar}</Svg>En el equipo desde el {since}</span>
            <span className="inline-flex items-center gap-1.5 font-mono"><Svg className="size-3.5">{I.id}</Svg>ID {shortId(me.id)}</span>
          </div>
        </div>
      </div>
      {error && <div className="px-6 pb-5"><Alert>{error}</Alert></div>}
    </section>
  );
}

/** Guarda un campo del perfil al salir de él, solo si cambió. */
function useSaveField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Record<Editable, string>>) => api<Profile>('/api/v1/me/profile', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (data) => queryClient.setQueryData(PROFILE_KEY, data),
  });
}

function PersonalInfo({ me }: { me: Profile }) {
  const queryClient = useQueryClient();
  const save = useSaveField();
  const [editingName, setEditingName] = useState(false);
  const [nameError, setNameError] = useState(false);
  const { first, last } = splitName(me.name);

  async function saveName(form: HTMLFormElement) {
    const data = new FormData(form);
    const name = `${String(data.get('first')).trim()} ${String(data.get('last')).trim()}`.trim();
    if (name.length < 2) return;
    const { error } = await authClient.updateUser({ name });
    setNameError(Boolean(error));
    if (error) return;
    setEditingName(false);
    queryClient.setQueryData<Profile>(PROFILE_KEY, (p) => (p ? { ...p, name } : p));
  }

  const blurSave = (field: Editable, current: string | null) => (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.target.value.trim() !== (current ?? '')) save.mutate({ [field]: e.target.value });
  };

  return (
    <section className={`${card} p-5`}>
      <CardHeader icon={I.user} title="Información personal" subtitle="Tu equipo ve esto en las tarjetas de negocios, en los chats y en la lista del equipo." />
      <form onSubmit={(e) => { e.preventDefault(); void saveName(e.currentTarget); }} className="mt-5 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        <label>
          <span className={fieldLabel}>Nombre</span>
          <span className={fieldBox}>
            <input name="first" defaultValue={first} key={`f-${me.name}`} readOnly={!editingName} required maxLength={60} className="min-w-0 flex-1 bg-transparent outline-none read-only:text-ink" />
            {!editingName && <Svg className="size-3.5 text-muted">{I.lock}</Svg>}
          </span>
        </label>
        <label>
          <span className={fieldLabel}>Apellido</span>
          <span className={fieldBox}>
            <input name="last" defaultValue={last} key={`l-${me.name}`} readOnly={!editingName} maxLength={60} className="min-w-0 flex-1 bg-transparent outline-none" />
            {!editingName && <Svg className="size-3.5 text-muted">{I.lock}</Svg>}
          </span>
        </label>
        <p className="text-xs text-muted sm:col-span-2">
          {editingName ? (
            <><button type="submit" className="font-semibold text-honey-ink hover:underline">Guardar nombre</button> · <button type="button" onClick={() => setEditingName(false)} className="text-ink hover:underline">Cancelar</button></>
          ) : (
            <>El nombre y el correo son los de tu cuenta de BeeCRM · <button type="button" onClick={() => setEditingName(true)} className="font-medium text-ink hover:underline">Cambiar</button></>
          )}
        </p>
        {nameError && <div className="sm:col-span-2"><Alert>No pudimos cambiar tu nombre. Inténtalo de nuevo.</Alert></div>}
      </form>

      <div className="mt-5 grid gap-x-4 gap-y-5 sm:grid-cols-2">
        <label>
          <span className={fieldLabel}>Teléfono</span>
          <span className={fieldBox}>
            <Svg className="size-3.5 shrink-0 text-muted">{I.phone}</Svg>
            <input type="tel" defaultValue={me.phone ?? ''} placeholder="+57 …" maxLength={40} onBlur={blurSave('phone', me.phone)} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" />
          </span>
        </label>
        <label>
          <span className={fieldLabel}>Dirección</span>
          <span className={fieldBox}>
            <Svg className="size-3.5 shrink-0 text-muted">{I.pin}</Svg>
            <input defaultValue={me.address ?? ''} maxLength={200} onBlur={blurSave('address', me.address)} className="min-w-0 flex-1 bg-transparent outline-none" />
          </span>
        </label>
        <label>
          <span className={fieldLabel}>Cargo</span>
          <span className={fieldBox}>
            <Svg className="size-3.5 shrink-0 text-muted">{I.briefcase}</Svg>
            <input defaultValue={me.position ?? ''} placeholder="Ej.: Asesor comercial" maxLength={80} onBlur={blurSave('position', me.position)} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" />
          </span>
        </label>
        <div>
          <span className={fieldLabel}>Correo de inicio de sesión</span>
          <span className={fieldBox}>
            <Svg className="size-3.5 shrink-0 text-honey-ink">{I.mail}</Svg>
            <span className="min-w-0 flex-1 truncate">{me.email}</span>
            <Svg className="size-3.5 text-muted">{I.lock}</Svg>
          </span>
          <p className="mt-1.5 text-xs text-muted">Es el correo con el que entras a todas tus empresas en BeeCRM.</p>
        </div>
      </div>
      <SaveStatus pending={save.isPending} error={save.isError} done={save.isSuccess} />
    </section>
  );
}

function AboutMe({ me }: { me: Profile }) {
  const save = useSaveField();
  const [length, setLength] = useState(me.bio?.length ?? 0);
  return (
    <section className={`${card} p-5`}>
      <CardHeader icon={I.file} title="Sobre mí" subtitle="Un par de líneas para tu equipo: qué haces y cuándo estás disponible." />
      <textarea
        aria-label="Sobre mí"
        defaultValue={me.bio ?? ''}
        maxLength={1000}
        rows={3}
        placeholder="Cuéntanos un poco sobre ti…"
        onChange={(e) => setLength(e.target.value.length)}
        onBlur={(e) => { if (e.target.value.trim() !== (me.bio ?? '')) save.mutate({ bio: e.target.value }); }}
        className="mt-5 w-full resize-y rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted focus:border-honey focus:ring-2 focus:ring-honey/30"
      />
      <div className="flex items-center justify-between gap-3">
        <SaveStatus pending={save.isPending} error={save.isError} done={save.isSuccess} />
        <p className="ml-auto text-xs text-muted">{length} / 1000</p>
      </div>
    </section>
  );
}

function SaveStatus({ pending, error, done }: { pending: boolean; error: boolean; done: boolean }) {
  if (pending) return <p role="status" className="mt-2 text-xs text-muted">Guardando…</p>;
  if (error) return <p role="alert" className="mt-2 text-xs text-danger">No se pudo guardar. Inténtalo de nuevo.</p>;
  if (done) return <p role="status" className="mt-2 text-xs text-success">Guardado.</p>;
  return null;
}

function MyActivity({ companyName }: { companyName: string }) {
  const activity = useQuery({ queryKey: ['me', 'activity'], queryFn: () => api<Activity>('/api/v1/me/activity') });
  const { date, time, region } = useRegion();
  const now = new Date();
  const a = activity.data;
  const tiles: { icon: ReactNode; label: string; value: number | undefined; hint: string }[] = [
    { icon: I.chart, label: 'Negocios en curso', value: a?.deals.open, hint: `ganados este mes: ${a?.deals.wonThisMonth ?? 0}` },
    { icon: I.task, label: 'Mis tareas', value: a?.tasks.open, hint: `${a?.tasks.today ?? 0} hoy · ${a?.tasks.overdue ?? 0} vencidas` },
    { icon: I.bell, label: 'Recordatorios hoy', value: a?.reminders.today, hint: `${a?.reminders.overdue ?? 0} vencidos` },
    { icon: I.chat, label: 'Conversaciones', value: a?.conversations.open, hint: a?.conversations.unread ? `${a.conversations.unread} sin leer` : 'nada sin leer' },
  ];
  return (
    <section className={`${card} p-5`}>
      <CardHeader icon={I.chart} title="Mi actividad" subtitle={`en ${companyName}`} />
      {activity.isError && <div className="mt-4"><Alert>No pudimos cargar tu actividad.</Alert></div>}
      <div className="mt-5 grid grid-cols-2 gap-2.5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-line p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted"><Svg className="size-3.5">{t.icon}</Svg>{t.label}</p>
            <p className="mt-1.5 text-2xl font-bold text-ink">{t.value ?? '–'}</p>
            <p className="mt-1 text-xs text-muted">{t.hint}</p>
          </div>
        ))}
      </div>
      <h4 className="mt-5 flex items-center gap-1.5 border-b border-line pb-2 text-xs font-bold uppercase tracking-wide text-muted"><Svg className="size-3.5">{I.clock}</Svg>Acciones recientes</h4>
      {a && !a.recent.length && <p className="py-4 text-xs text-muted">Todavía no hay acciones tuyas en negocios.</p>}
      <ul className="divide-y divide-line">
        {a?.recent.map((e) => (
          <li key={e.id}>
            <Link {...(linkTarget(`/deals?deal=${e.dealId}`) as { to: '/' })} className="block py-3 transition hover:bg-canvas">
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm text-ink">{e.dealTitle}</span>
                <span className="shrink-0 text-xs text-muted">{whenLabel(e.createdAt, now, region.timeZone, { date, time })}</span>
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted">{eventLabel(e.type)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MyCompanies() {
  const companies = useQuery({ queryKey: COMPANIES_KEY, queryFn: () => api<MyCompany[]>('/api/v1/my-companies') });
  return (
    <section className={`${card} p-5`}>
      <CardHeader
        icon={I.building}
        title="Mis empresas y roles"
        action={<Link to="/profile" search={{ tab: 'empresa' }} className="inline-flex items-center gap-0.5 text-xs font-semibold text-honey-ink hover:underline">Gestionar<Svg className="size-3.5">{I.chevron}</Svg></Link>}
      />
      <ul className="mt-4 flex flex-col gap-2">
        {companies.data?.map((c) => (
          <li key={c.id} className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3 ${c.active ? 'border-honey bg-honey-soft/40' : 'border-line'}`}>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink">{c.name}</span>
              <span className="text-xs text-muted">{ROLE_LABELS[c.role]}</span>
            </span>
            {c.active && <span className="rounded-full bg-honey px-2 py-0.5 text-[10px] font-bold text-on-honey">Activa</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export { I as ICONS };
