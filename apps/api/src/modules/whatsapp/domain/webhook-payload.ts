export interface InboundMessage {
  waMessageId: string;
  from: string; // E.164
  profileName: string | null;
  at: Date;
  type: string;
  body: string | null;
  media: { id: string; mimeType: string | null } | null;
}

export interface StatusUpdate {
  waMessageId: string;
  status: string;
  at: Date;
  error: { code: number; title: string } | null;
}

export interface WebhookBatch {
  phoneNumberId: string;
  messages: InboundMessage[];
  statuses: StatusUpdate[];
}

const MEDIA_TYPES = ['image', 'audio', 'video', 'document', 'sticker'] as const;
type Json = Record<string, any>;

/** E04-S02 — Traduce el payload de Meta a algo que el dominio entiende. Tolerante: lo desconocido se ignora. */
export function parseWebhook(payload: unknown): WebhookBatch[] {
  const root = payload as Json | null;
  if (root?.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return [];
  const batches: WebhookBatch[] = [];

  for (const entry of root.entry as Json[]) {
    for (const change of (entry?.changes ?? []) as Json[]) {
      const value = change?.value as Json | undefined;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (change?.field !== 'messages' || typeof phoneNumberId !== 'string') continue;

      const names = new Map<string, string>(((value!.contacts ?? []) as Json[]).map((c) => [c.wa_id, c.profile?.name]));
      const messages = ((value!.messages ?? []) as Json[])
        .filter((m) => typeof m.id === 'string' && typeof m.from === 'string')
        .map((m): InboundMessage => {
          const mediaType = MEDIA_TYPES.find((t) => m.type === t);
          const media = mediaType ? (m[mediaType] as Json | undefined) : undefined;
          return {
            waMessageId: m.id,
            from: `+${m.from}`,
            profileName: names.get(m.from) ?? null,
            at: new Date(Number(m.timestamp) * 1000),
            type: m.type ?? 'unknown',
            body: m.text?.body ?? media?.caption ?? m.button?.text ?? m.interactive?.button_reply?.title ?? null,
            media: media?.id ? { id: media.id, mimeType: media.mime_type ?? null } : null,
          };
        });
      const statuses = ((value!.statuses ?? []) as Json[])
        .filter((s) => typeof s.id === 'string' && typeof s.status === 'string')
        .map((s): StatusUpdate => ({
          waMessageId: s.id,
          status: s.status,
          at: new Date(Number(s.timestamp) * 1000),
          error: s.errors?.[0] ? { code: Number(s.errors[0].code), title: String(s.errors[0].title ?? '') } : null,
        }));
      if (messages.length || statuses.length) batches.push({ phoneNumberId, messages, statuses });
    }
  }
  return batches;
}

export interface TemplateStatusUpdate {
  wabaId: string;
  templateId: string;
  status: 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED';
  reason: string | null;
}

const TEMPLATE_EVENTS: Record<string, TemplateStatusUpdate['status']> = {
  APPROVED: 'APPROVED', REJECTED: 'REJECTED', PAUSED: 'PAUSED', DISABLED: 'DISABLED', PENDING_DELETION: 'DISABLED', FLAGGED: 'PAUSED',
};

/** E04-S05 — Meta avisa por webhook cuando aprueba o rechaza una plantilla (llega por WABA, no por número). */
export function parseTemplateUpdates(payload: unknown): TemplateStatusUpdate[] {
  const root = payload as Json | null;
  if (root?.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return [];
  return (root.entry as Json[]).flatMap((entry) =>
    ((entry?.changes ?? []) as Json[])
      .filter((c) => c?.field === 'message_template_status_update' && typeof entry.id === 'string')
      .map((c) => ({ value: c.value as Json, status: TEMPLATE_EVENTS[String(c.value?.event)] }))
      .filter((u) => u.status && u.value?.message_template_id)
      .map((u) => ({ wabaId: entry.id, templateId: String(u.value.message_template_id), status: u.status!, reason: u.value.reason && u.value.reason !== 'NONE' ? String(u.value.reason) : null })),
  );
}
