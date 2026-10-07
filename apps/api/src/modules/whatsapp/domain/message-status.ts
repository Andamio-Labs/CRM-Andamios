export type MessageStatus = 'received' | 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

const RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };

/**
 * Los webhooks de estado llegan desordenados (Meta no garantiza orden): un "delivered"
 * tardío nunca debe pisar un "read". failed solo aplica antes de entregar.
 */
export function canAdvanceStatus(from: MessageStatus, to: string): boolean {
  if (to === 'failed') return from === 'pending' || from === 'sent';
  if (!(from in RANK) || !(to in RANK)) return false;
  return RANK[to]! > RANK[from]!;
}
