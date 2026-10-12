export interface FeedItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
  important: boolean;
}

export type FeedFilter = 'all' | 'unread' | 'important';

const MATCHES: Record<FeedFilter, (n: FeedItem) => boolean> = {
  all: () => true,
  unread: (n) => !n.readAt,
  important: (n) => n.important,
};

export function filterFeed(items: FeedItem[], filter: FeedFilter) {
  return items.filter(MATCHES[filter]);
}

export function feedCounts(items: FeedItem[]): Record<FeedFilter, number> {
  return { all: items.length, unread: items.filter(MATCHES.unread).length, important: items.filter(MATCHES.important).length };
}

/** Agrupa por día en la zona horaria de la empresa (la lista ya viene de la más nueva a la más vieja). */
export function groupByDay(items: FeedItem[], now: Date, timeZone: string, dateLabel: (iso: string) => string) {
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const today = dayKey.format(now);
  const yesterday = dayKey.format(new Date(now.getTime() - 86_400_000));
  const groups: { key: string; label: string; items: FeedItem[] }[] = [];
  for (const n of items) {
    const key = dayKey.format(new Date(n.createdAt));
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label: key === today ? 'Hoy' : key === yesterday ? 'Ayer' : dateLabel(n.createdAt), items: [] };
      groups.push(group);
    }
    group.items.push(n);
  }
  return groups;
}

export function relativeTime(iso: string, now: Date) {
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'Justo ahora';
  if (minutes < 60) return `Hace ${minutes} min`;
  if (minutes < 24 * 60) return `Hace ${Math.floor(minutes / 60)} h`;
  return `Hace ${Math.floor(minutes / (24 * 60))} d`;
}
