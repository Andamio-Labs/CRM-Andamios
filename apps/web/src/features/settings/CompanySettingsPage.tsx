import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { type FormEvent, type ReactNode, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { useMyRole } from '../../shared/use-my-role';
import { AppShell } from '../../shared/ui/app-shell';
import { Alert } from '../../shared/ui/form';
import { inputClass, labelClass, primaryButton, SettingsSection, textareaClass } from '../../shared/ui/section';
import { AiSettings } from '../ai/AiSettings';
import { AuditSettings } from './AuditSettings';
import { BillingSettings } from './BillingSettings';
import { DangerZone } from './DangerZone';
import { GrowthSettings } from './GrowthSettings';
import { MessagingSettings } from './MessagingSettings';
import { NotificationSettings } from './NotificationSettings';
import { PrivacySettings } from './PrivacySettings';
import { type SettingsTab, tabFrom, tabsFor } from './settings-tabs';
import { WhatsAppSettings } from './WhatsAppSettings';

type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
interface Settings {
  timezone: string;
  currency: string;
  locale: string;
  businessHours: Record<Day, { from: string; to: string }[]>;
  sellersSeeOnlyAssigned: boolean;
  outOfHoursEnabled: boolean;
  outOfHoursMessage: string;
}

const DAYS: [Day, string][] = [
  ['mon', 'Lunes'], ['tue', 'Martes'], ['wed', 'Miércoles'], ['thu', 'Jueves'],
  ['fri', 'Viernes'], ['sat', 'Sábado'], ['sun', 'Domingo'],
];
const TIMEZONES = [
  'America/Bogota', 'America/Mexico_City', 'America/Lima', 'America/Santiago',
  'America/Argentina/Buenos_Aires', 'America/Sao_Paulo', 'America/Guayaquil', 'America/Panama',
];
const CURRENCIES = ['COP', 'MXN', 'PEN', 'CLP', 'ARS', 'BRL', 'USD'];
const LOCALES: [string, string][] = [
  ['es-CO', 'Español (Colombia)'], ['es-MX', 'Español (México)'], ['es-PE', 'Español (Perú)'],
  ['es-CL', 'Español (Chile)'], ['es-AR', 'Español (Argentina)'], ['pt-BR', 'Português (Brasil)'],
];

const TAB_CONTENT: Record<SettingsTab, () => ReactNode> = {
  general: () => <><CompanySection /><NotificationSettings /></>,
  canales: () => <><WhatsAppSettings /><MessagingSettings /><GrowthSettings /></>,
  ia: () => <AiSettings />,
  plan: () => <BillingSettings />,
  privacidad: () => <><PrivacySettings /><AuditSettings /><DangerZone /></>,
};

/** E01-S06 — Configuración, agrupada en pestañas. Cada notificación enlaza a la suya (`?tab=`). */
export function CompanySettingsPage() {
  const role = useMyRole();
  const search = useSearch({ from: '/settings' });
  if (!role) return <AppShell title="Configuración"><p className="text-xs text-muted">Cargando…</p></AppShell>;
  const tab = tabFrom(search.tab, role);
  const Content = TAB_CONTENT[tab];
  return (
    <AppShell title="Configuración" subtitle="Tu empresa, tus canales, el asistente y la cuenta." wide>
      <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,48rem)]">
        <nav aria-label="Secciones de configuración" className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1 shadow-sm lg:sticky lg:top-14 lg:flex-col lg:self-start">
          {tabsFor(role).map((t) => (
            <Link
              key={t.id}
              to="/settings"
              search={{ tab: t.id }}
              aria-current={t.id === tab ? 'page' : undefined}
              className={`flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-xs ${t.id === tab ? 'bg-honey font-semibold text-ink' : 'text-muted hover:bg-canvas hover:text-ink'}`}
            >
              <span aria-hidden className="w-4 text-center">{t.icon}</span>{t.label}
            </Link>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-4"><Content /></div>
      </div>
    </AppShell>
  );
}

function CompanySection() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['tenant-settings'], queryFn: () => api<Settings>('/api/v1/tenant/settings') });
  const save = useMutation({
    mutationFn: (body: Partial<Settings>) => api<Settings>('/api/v1/tenant/settings', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (data) => queryClient.setQueryData(['tenant-settings'], data),
  });
  return (
    <SettingsSection icon="⌂" title="Empresa" description="Zona horaria, moneda, idioma, horario de atención y qué ve cada vendedor.">
      {settings.isPending && <p className="text-xs text-muted">Cargando…</p>}
      {settings.isError && <Alert>No pudimos cargar la configuración.</Alert>}
      {settings.data && (
        <SettingsForm
          key={JSON.stringify(settings.data)}
          initial={settings.data}
          saving={save.isPending}
          result={save.isSuccess ? 'ok' : save.isError ? (save.error instanceof ApiError && save.error.status === 403 ? 'forbidden' : 'error') : undefined}
          onSave={(body) => save.mutate(body)}
        />
      )}
    </SettingsSection>
  );
}

function SettingsForm({ initial, saving, result, onSave }: {
  initial: Settings;
  saving: boolean;
  result?: 'ok' | 'error' | 'forbidden';
  onSave: (body: Settings) => void;
}) {
  const [hours, setHours] = useState(initial.businessHours);

  function setDay(day: Day, value: { from: string; to: string }[]) {
    setHours((h) => ({ ...h, [day]: value }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      timezone: String(form.get('timezone')),
      currency: String(form.get('currency')),
      locale: String(form.get('locale')),
      businessHours: hours,
      sellersSeeOnlyAssigned: form.get('sellersSeeOnlyAssigned') === 'on',
      outOfHoursEnabled: form.get('outOfHoursEnabled') === 'on',
      outOfHoursMessage: String(form.get('outOfHoursMessage') ?? initial.outOfHoursMessage),
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={labelClass}>
          Zona horaria
          <select name="timezone" defaultValue={initial.timezone} className={inputClass}>
            {[...new Set([initial.timezone, ...TIMEZONES])].map((tz) => <option key={tz}>{tz}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          Moneda
          <select name="currency" defaultValue={initial.currency} className={inputClass}>
            {[...new Set([initial.currency, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          Idioma
          <select name="locale" defaultValue={initial.locale} className={inputClass}>
            {LOCALES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      <fieldset className="rounded-lg border border-line p-3">
        <legend className="px-1 text-xs font-semibold text-muted">Horario laboral</legend>
        <div className="flex flex-col divide-y divide-line">
          {DAYS.map(([day, label]) => {
            const range = hours[day][0];
            return (
              <div key={day} className="flex flex-wrap items-center gap-3 py-2.5">
                <label className="flex w-32 items-center gap-2 text-xs text-ink">
                  <input
                    type="checkbox"
                    checked={Boolean(range)}
                    onChange={(e) => setDay(day, e.target.checked ? [{ from: '08:00', to: '18:00' }] : [])}
                    className="size-4 accent-honey"
                  />
                  {label}
                </label>
                {range ? (
                  <div className="flex items-center gap-2 text-sm">
                    <input aria-label={`${label} desde`} type="time" value={range.from} onChange={(e) => setDay(day, [{ ...range, from: e.target.value }])} className="h-9 rounded-lg border border-line px-2 text-xs" />
                    <span className="text-xs text-muted">a</span>
                    <input aria-label={`${label} hasta`} type="time" value={range.to} onChange={(e) => setDay(day, [{ ...range, to: e.target.value }])} className="h-9 rounded-lg border border-line px-2 text-xs" />
                  </div>
                ) : (
                  <span className="text-xs text-muted">Cerrado</span>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

      <label className="flex items-start gap-3 rounded-lg border border-line p-3">
        <input type="checkbox" name="sellersSeeOnlyAssigned" defaultChecked={initial.sellersSeeOnlyAssigned} className="mt-1 size-4 accent-honey" />
        <span>
          <span className="block text-xs font-semibold text-ink">Cada vendedor ve solo lo suyo</span>
          <span className="block text-xs text-muted">Los vendedores solo verán los contactos, negocios y conversaciones que tengan asignados. Propietarios y administradores siempre ven todo.</span>
        </span>
      </label>

      <fieldset className="rounded-lg border border-line p-3">
        <legend className="px-1 text-xs font-semibold text-muted">Fuera de horario</legend>
        <label className="flex items-start gap-3">
          <input type="checkbox" name="outOfHoursEnabled" defaultChecked={initial.outOfHoursEnabled} className="mt-1 size-4 accent-honey" />
          <span className="text-xs text-ink">Responder automáticamente fuera del horario laboral (una vez por conversación). Si el asistente de IA está atendiendo, responde él.</span>
        </label>
        <label className={`${labelClass} mt-3`}>
          Mensaje automático
          <textarea name="outOfHoursMessage" defaultValue={initial.outOfHoursMessage} maxLength={1000} rows={2} className={textareaClass} />
        </label>
      </fieldset>

      {result === 'ok' && <Alert tone="success">Cambios guardados.</Alert>}
      {result === 'forbidden' && <Alert>Solo el propietario puede cambiar la configuración.</Alert>}
      {result === 'error' && <Alert>Revisa los datos: hay valores inválidos.</Alert>}
      <div>
        <button type="submit" disabled={saving} className={primaryButton}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
      </div>
    </form>
  );
}
