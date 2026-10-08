import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { AppShell } from '../../shared/ui/app-shell';
import { AgentSettings } from './AgentSettings';
import { AuditSettings } from './AuditSettings';
import { BillingSettings } from './BillingSettings';
import { DangerZone } from './DangerZone';
import { NotificationSettings } from './NotificationSettings';
import { PrivacySettings } from './PrivacySettings';
import { GrowthSettings } from './GrowthSettings';
import { MessagingSettings } from './MessagingSettings';
import { WhatsAppSettings } from './WhatsAppSettings';
import { Alert, Button } from '../../shared/ui/form';

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

/** E01-S06 — Configuración de empresa. */
export function CompanySettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['tenant-settings'], queryFn: () => api<Settings>('/api/v1/tenant/settings') });
  const save = useMutation({
    mutationFn: (body: Partial<Settings>) => api<Settings>('/api/v1/tenant/settings', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (data) => queryClient.setQueryData(['tenant-settings'], data),
  });

  return (
    <AppShell title="Configuración de la empresa" subtitle="Zona horaria, moneda, idioma, horario de atención y visibilidad.">

        {settings.isPending && <p className="text-muted">Cargando…</p>}
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
      <NotificationSettings />
      <WhatsAppSettings />
      <MessagingSettings />
      <GrowthSettings />
      <AgentSettings />
      <BillingSettings />
      <PrivacySettings />
      <AuditSettings />
      <DangerZone />
    </AppShell>
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

  const select = 'h-11 w-full rounded-lg border border-line bg-surface px-3 text-ink';
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
          Zona horaria
          <select name="timezone" defaultValue={initial.timezone} className={select}>
            {[...new Set([initial.timezone, ...TIMEZONES])].map((tz) => <option key={tz}>{tz}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
          Moneda
          <select name="currency" defaultValue={initial.currency} className={select}>
            {[...new Set([initial.currency, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
          Idioma
          <select name="locale" defaultValue={initial.locale} className={select}>
            {LOCALES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      <fieldset className="rounded-xl border border-line bg-surface p-4">
        <legend className="px-1 text-sm font-medium text-ink">Horario laboral</legend>
        <div className="flex flex-col divide-y divide-line">
          {DAYS.map(([day, label]) => {
            const range = hours[day][0];
            return (
              <div key={day} className="flex flex-wrap items-center gap-3 py-2.5">
                <label className="flex w-32 items-center gap-2 text-sm text-ink">
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
                    <input aria-label={`${label} desde`} type="time" value={range.from} onChange={(e) => setDay(day, [{ ...range, from: e.target.value }])} className="rounded-md border border-line px-2 py-1" />
                    <span className="text-muted">a</span>
                    <input aria-label={`${label} hasta`} type="time" value={range.to} onChange={(e) => setDay(day, [{ ...range, to: e.target.value }])} className="rounded-md border border-line px-2 py-1" />
                  </div>
                ) : (
                  <span className="text-sm text-muted">Cerrado</span>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

      <label className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4">
        <input type="checkbox" name="sellersSeeOnlyAssigned" defaultChecked={initial.sellersSeeOnlyAssigned} className="mt-1 size-4 accent-honey" />
        <span>
          <span className="block font-medium text-ink">Cada vendedor ve solo lo suyo</span>
          <span className="block text-sm text-muted">Los vendedores solo verán los contactos, negocios y conversaciones que tengan asignados. Propietarios y administradores siempre ven todo.</span>
        </span>
      </label>

      <fieldset className="rounded-xl border border-line bg-surface p-4">
        <legend className="px-1 text-sm font-medium text-ink">Fuera de horario</legend>
        <label className="flex items-start gap-3">
          <input type="checkbox" name="outOfHoursEnabled" defaultChecked={initial.outOfHoursEnabled} className="mt-1 size-4 accent-honey" />
          <span className="text-sm text-ink">Responder automáticamente fuera del horario laboral (una vez por conversación).</span>
        </label>
        <label className="mt-3 flex flex-col gap-1.5 text-sm font-medium text-ink">
          Mensaje automático
          <textarea name="outOfHoursMessage" defaultValue={initial.outOfHoursMessage} maxLength={1000} rows={2} className="rounded-lg border border-line bg-surface px-3 py-2 font-normal" />
        </label>
      </fieldset>

      {result === 'ok' && <Alert tone="success">Cambios guardados.</Alert>}
      {result === 'forbidden' && <Alert>Solo el propietario puede cambiar la configuración.</Alert>}
      {result === 'error' && <Alert>Revisa los datos: hay valores inválidos.</Alert>}
      <div>
        <Button type="submit" loading={saving}>Guardar cambios</Button>
      </div>
    </form>
  );
}
