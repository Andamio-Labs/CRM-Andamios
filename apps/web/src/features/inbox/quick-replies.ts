export interface QuickReply {
  id: string;
  shortcut: string;
  body: string;
}

export interface QuickReplyContext {
  contact: { name: string; phone: string | null };
  user: { name: string };
}

/** E04-S08 — "/sal" sugiere los atajos que empiezan con "sal". Con un espacio ya es un mensaje normal. */
export function matchQuickReplies(input: string, replies: QuickReply[]): QuickReply[] {
  if (!input.startsWith('/') || /\s/.test(input)) return [];
  const prefix = input.slice(1).toLowerCase();
  return replies.filter((r) => r.shortcut.startsWith(prefix));
}

export function renderQuickReply(body: string, ctx: QuickReplyContext): string {
  const values: Record<string, string | null> = {
    'contact.name': ctx.contact.name,
    'contact.phone': ctx.contact.phone,
    'user.name': ctx.user.name,
  };
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => values[key] ?? match);
}

export function templateVariableCount(body: string): number {
  const used = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return used.length ? Math.max(...used) : 0;
}
