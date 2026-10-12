import { describe, expect, it } from 'vitest';
import { feedCounts, filterFeed, type FeedItem, groupByDay, relativeTime } from './notification-feed';

const item = (id: string, createdAt: string, extra: Partial<FeedItem> = {}): FeedItem => ({
  id, type: 'task_reminder', title: id, body: null, link: null, readAt: null, createdAt, important: false, ...extra,
});

describe('Feed de notificaciones', () => {
  const items = [
    item('nueva', '2026-10-09T14:00:00Z'),
    item('leida', '2026-10-09T13:00:00Z', { readAt: '2026-10-09T13:05:00Z' }),
    item('cobro', '2026-10-08T15:00:00Z', { type: 'billing', important: true }),
  ];

  it('filtra por todas, sin leer e importantes', () => {
    expect(filterFeed(items, 'all').map((n) => n.id)).toEqual(['nueva', 'leida', 'cobro']);
    expect(filterFeed(items, 'unread').map((n) => n.id)).toEqual(['nueva', 'cobro']);
    expect(filterFeed(items, 'important').map((n) => n.id)).toEqual(['cobro']);
  });

  it('cuenta cada filtro', () => {
    expect(feedCounts(items)).toEqual({ all: 3, unread: 2, important: 1 });
  });

  it('agrupa por día en la zona horaria de la empresa: hoy, ayer y fecha', () => {
    const now = new Date('2026-10-09T15:00:00Z');
    const older = item('vieja', '2026-10-05T15:00:00Z');
    const groups = groupByDay([...items, older], now, 'America/Bogota', () => '5/10/2026');
    expect(groups.map((g) => [g.label, g.items.map((n) => n.id)])).toEqual([
      ['Hoy', ['nueva', 'leida']],
      ['Ayer', ['cobro']],
      ['5/10/2026', ['vieja']],
    ]);
  });

  it('la medianoche se corta en la zona horaria, no en UTC', () => {
    // 02:00 UTC del 9 es todavía el 8 a las 21:00 en Bogotá.
    const groups = groupByDay([item('noche', '2026-10-09T02:00:00Z')], new Date('2026-10-09T15:00:00Z'), 'America/Bogota', () => '');
    expect(groups[0]?.label).toBe('Ayer');
  });

  it('dice hace cuánto llegó', () => {
    const now = new Date('2026-10-09T15:00:00Z');
    expect(relativeTime('2026-10-09T14:59:30Z', now)).toBe('Justo ahora');
    expect(relativeTime('2026-10-09T14:55:00Z', now)).toBe('Hace 5 min');
    expect(relativeTime('2026-10-09T12:00:00Z', now)).toBe('Hace 3 h');
    expect(relativeTime('2026-10-07T15:00:00Z', now)).toBe('Hace 2 d');
  });
});
