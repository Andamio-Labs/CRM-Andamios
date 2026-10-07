import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { authClient } from '../../shared/auth-client';
import { Alert, Button } from '../../shared/ui/form';
import { matchQuickReplies, type QuickReply, renderQuickReply, templateVariableCount } from './quick-replies';

interface Template { id: string; name: string; body: string; status: string; language: string }

/**
 * Escribe mensajes (ventana abierta), plantillas (ventana cerrada) o notas internas.
 * E04-S04, E04-S05, E04-S08.
 */
export function Composer({ conversationId, windowOpen, contact }: {
  conversationId: string;
  windowOpen: boolean;
  contact: { name: string; phone: string | null };
}) {
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const [mode, setMode] = useState<'message' | 'note'>('message');
  const [text, setText] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [variables, setVariables] = useState<string[]>([]);

  const quickReplies = useQuery({ queryKey: ['quick-replies'], queryFn: () => api<QuickReply[]>('/api/v1/quick-replies'), staleTime: 60_000 });
  const templates = useQuery({ queryKey: ['wa-templates'], queryFn: () => api<Template[]>('/api/v1/whatsapp/templates'), enabled: !windowOpen && mode === 'message' });
  const approved = templates.data?.filter((t) => t.status === 'APPROVED') ?? [];
  const template = approved.find((t) => t.id === templateId);
  const suggestions = matchQuickReplies(text, quickReplies.data ?? []);

  const send = useMutation({
    mutationFn: (body: object) => api(`/api/v1/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setText('');
      setVariables([]);
      void queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
    },
  });

  const usingTemplate = mode === 'message' && !windowOpen;
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (usingTemplate) {
      if (template) send.mutate({ type: 'template', templateId: template.id, variables });
      return;
    }
    if (text.trim()) send.mutate({ type: mode === 'note' ? 'note' : 'text', text: text.trim() });
  }

  function applyQuickReply(reply: QuickReply) {
    setText(renderQuickReply(reply.body, { contact, user: { name: session.data?.user.name ?? '' } }));
  }

  return (
    <form onSubmit={onSubmit} className={`border-t border-line p-3 ${mode === 'note' ? 'bg-honey/10' : ''}`}>
      <div role="tablist" aria-label="Tipo de mensaje" className="mb-2 flex gap-1 text-sm">
        {(['message', 'note'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`min-h-11 rounded-md px-3 ${mode === m ? 'bg-honey font-semibold text-ink' : 'text-muted'}`}
          >
            {m === 'message' ? 'Mensaje al cliente' : 'Nota interna'}
          </button>
        ))}
      </div>

      {usingTemplate ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm text-ink">
            Plantilla aprobada
            <select value={templateId} onChange={(e) => { setTemplateId(e.target.value); setVariables([]); }} className="h-11 rounded-lg border border-line bg-surface px-2">
              <option value="">{templates.isPending ? 'Cargando…' : approved.length ? 'Elige una plantilla' : 'No hay plantillas aprobadas'}</option>
              {approved.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
            </select>
          </label>
          {template && <p className="text-sm text-muted">{template.body}</p>}
          {template && Array.from({ length: templateVariableCount(template.body) }, (_, i) => (
            <input
              key={i}
              aria-label={`Variable {{${i + 1}}}`}
              placeholder={`Valor para {{${i + 1}}}`}
              value={variables[i] ?? ''}
              onChange={(e) => setVariables((v) => Object.assign([...v], { [i]: e.target.value }))}
              className="h-11 rounded-lg border border-line bg-surface px-3"
            />
          ))}
          <div><Button type="submit" loading={send.isPending} disabled={!template}>Enviar plantilla</Button></div>
        </div>
      ) : (
        <div className="relative flex gap-2">
          {suggestions.length > 0 && (
            <ul role="listbox" aria-label="Respuestas rápidas" className="absolute bottom-full left-0 mb-2 max-h-48 w-full overflow-y-auto rounded-lg border border-line bg-surface shadow-lg">
              {suggestions.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => applyQuickReply(r)} className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left hover:bg-canvas">
                    <span className="text-sm font-medium text-ink">/{r.shortcut}</span>
                    <span className="w-full truncate text-xs text-muted">{r.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={1}
            aria-label={mode === 'note' ? 'Nota interna (no la ve el cliente)' : 'Mensaje (escribe / para respuestas rápidas)'}
            placeholder={mode === 'note' ? 'Nota interna: solo la ve tu equipo' : 'Escribe un mensaje o / para respuestas rápidas'}
            className="min-h-11 min-w-0 flex-1 resize-y rounded-lg border border-line bg-surface px-3 py-2.5"
          />
          <Button type="submit" loading={send.isPending}>{mode === 'note' ? 'Guardar nota' : 'Enviar'}</Button>
        </div>
      )}
      {send.isError && <div className="mt-2"><Alert>{send.error instanceof ApiError ? send.error.message : 'No pudimos enviar.'}</Alert></div>}
    </form>
  );
}
