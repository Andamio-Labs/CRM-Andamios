import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { SettingsSection } from '../../shared/ui/section';
import { Alert, Button, Field } from '../../shared/ui/form';
import { templateVariableCount } from '../inbox/quick-replies';

interface Template { id: string; name: string; language: string; category: string; body: string; status: string; rejectionReason: string | null }
interface Channel { id: string; verifiedName: string | null; phoneNumberId: string }
interface QuickReply { id: string; shortcut: string; body: string }

const STATUS: Record<string, string> = { PENDING: 'En revisión de Meta', APPROVED: 'Aprobada', REJECTED: 'Rechazada', PAUSED: 'Pausada por Meta', DISABLED: 'Deshabilitada' };
const errorText = (e: unknown) => (e instanceof ApiError ? (e.status === 403 ? 'Solo propietarios y administradores pueden hacer esto.' : e.message) : 'Algo salió mal.');

/** E04-S05 plantillas + E04-S08 respuestas rápidas. */
export function MessagingSettings() {
  return (
    <>
      <Templates />
      <QuickReplies />
    </>
  );
}

function Templates() {
  const queryClient = useQueryClient();
  const templates = useQuery({ queryKey: ['wa-templates'], queryFn: () => api<Template[]>('/api/v1/whatsapp/templates') });
  const channels = useQuery({ queryKey: ['wa-channels'], queryFn: () => api<Channel[]>('/api/v1/whatsapp/channels') });
  const [body, setBody] = useState('');
  const create = useMutation({
    mutationFn: (payload: object) => api('/api/v1/whatsapp/templates', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wa-templates'] }),
  });
  const variables = templateVariableCount(body);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    create.mutate({
      channelId: String(form.get('channelId')),
      name: String(form.get('name')),
      language: String(form.get('language')),
      category: String(form.get('category')),
      body,
      examples: Array.from({ length: variables }, (_, i) => String(form.get(`example${i}`) ?? '')),
    });
  }

  return (
    <SettingsSection icon="▤" title="Plantillas de WhatsApp" description={<>Fuera de la ventana de 24 horas solo puedes escribir con plantillas aprobadas por Meta. Usa {'{{1}}'}, {'{{2}}'}… para las variables.</>}>
      {templates.isError && <div className="mt-3"><Alert>No pudimos cargar las plantillas.</Alert></div>}
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface empty:hidden">
        {templates.data?.map((t) => (
          <li key={t.id} className="px-4 py-3">
            <p className="font-medium text-ink">{t.name} <span className="text-sm font-normal text-muted">({t.language} · {t.category})</span></p>
            <p className="text-sm text-muted">{t.body}</p>
            <p className={`text-sm ${t.status === 'APPROVED' ? 'text-success' : t.status === 'REJECTED' ? 'text-danger' : 'text-ink'}`}>
              {STATUS[t.status] ?? t.status}{t.rejectionReason ? `: ${t.rejectionReason}` : ''}
            </p>
          </li>
        ))}
      </ul>
      {Boolean(channels.data?.length) && (
        <form onSubmit={onSubmit} className="mt-4 grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2">
          <Field label="Nombre (minúsculas y _)" name="name" required pattern="[a-z0-9_]+" />
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Número
            <select name="channelId" className="h-11 rounded-lg border border-line bg-surface px-3">
              {channels.data!.map((c) => <option key={c.id} value={c.id}>{c.verifiedName ?? c.phoneNumberId}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Categoría
            <select name="category" className="h-11 rounded-lg border border-line bg-surface px-3">
              <option value="UTILITY">Utilidad (recordatorios, avisos)</option>
              <option value="MARKETING">Marketing (promociones)</option>
              <option value="AUTHENTICATION">Autenticación (códigos)</option>
            </select>
          </label>
          <Field label="Idioma" name="language" defaultValue="es_CO" required />
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink sm:col-span-2">
            Texto
            <textarea value={body} onChange={(e) => setBody(e.target.value)} required maxLength={1024} rows={3} className="rounded-lg border border-line bg-surface px-3 py-2" />
          </label>
          {Array.from({ length: variables }, (_, i) => <Field key={i} label={`Ejemplo para {{${i + 1}}}`} name={`example${i}`} required />)}
          {create.isError && <div className="sm:col-span-2"><Alert>{errorText(create.error)}</Alert></div>}
          {create.isSuccess && <div className="sm:col-span-2"><Alert tone="success">Plantilla enviada a revisión de Meta.</Alert></div>}
          <div className="sm:col-span-2"><Button type="submit" loading={create.isPending}>Enviar a aprobación</Button></div>
        </form>
      )}
    </SettingsSection>
  );
}

function QuickReplies() {
  const queryClient = useQueryClient();
  const replies = useQuery({ queryKey: ['quick-replies'], queryFn: () => api<QuickReply[]>('/api/v1/quick-replies') });
  const create = useMutation({
    mutationFn: (payload: object) => api('/api/v1/quick-replies', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quick-replies'] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/v1/quick-replies/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quick-replies'] }),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    create.mutate({ shortcut: String(form.get('shortcut')), body: String(form.get('body')) }, { onSuccess: () => formEl.reset() });
  }

  return (
    <SettingsSection icon="⚡" title="Respuestas rápidas" description={<>En la bandeja escribe / y el atajo. Variables: {'{{contact.name}}'}, {'{{contact.phone}}'}, {'{{user.name}}'}.</>}>
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface empty:hidden">
        {replies.data?.map((r) => (
          <li key={r.id} className="flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">/{r.shortcut}</p>
              <p className="text-sm text-muted">{r.body}</p>
            </div>
            <button onClick={() => remove.mutate(r.id)} className="inline-flex min-h-11 items-center px-2 text-sm text-muted underline">Eliminar</button>
          </li>
        ))}
      </ul>
      <form onSubmit={onSubmit} className="mt-4 grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[12rem_1fr]">
        <Field label="Atajo" name="shortcut" required pattern="[a-z0-9_-]+" placeholder="saludo" />
        <Field label="Texto" name="body" required placeholder="Hola {{contact.name}}, ¿en qué te ayudo?" />
        {(create.isError || remove.isError) && <div className="sm:col-span-2"><Alert>{errorText(create.error ?? remove.error)}</Alert></div>}
        <div className="sm:col-span-2"><Button type="submit" loading={create.isPending}>Guardar respuesta</Button></div>
      </form>
    </SettingsSection>
  );
}
