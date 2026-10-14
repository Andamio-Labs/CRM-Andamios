import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api';
import { useRealtime } from '../../shared/realtime';

export type PresenceStatus = 'online' | 'visit' | 'dnd' | 'offline';
export type PresenceDuration = 'until_changed' | '1h' | 'end_of_day';

export interface Presence {
  userId: string;
  name: string;
  status: PresenceStatus;
  /** Hasta cuándo dura el estado elegido; null = hasta que lo cambie. */
  until: string | null;
}

/** E01-S09 — Qué significa cada estado, tal como lo aplica la API (correos y asignación de leads). */
export const PRESENCE: Record<PresenceStatus, { label: string; hint: string; dot: string }> = {
  online: { label: 'En línea', hint: 'Recibes avisos y leads nuevos como siempre.', dot: 'bg-success' },
  visit: { label: 'En visita', hint: 'En una reunión o visita: respondes con demora. Avisos y leads como siempre.', dot: 'bg-info' },
  dnd: { label: 'No molestar', hint: 'Los avisos esperan en la campana, sin push ni correo. No te asignamos leads nuevos.', dot: 'bg-danger' },
  offline: { label: 'Desconectado', hint: 'Fuera del trabajo: los avisos esperan en la campana, sin push ni correo, y no te asignamos leads nuevos.', dot: 'bg-muted' },
};

export const PRESENCE_ORDER: PresenceStatus[] = ['online', 'visit', 'dnd', 'offline'];

export const DURATIONS: [PresenceDuration, string][] = [
  ['until_changed', 'Hasta que lo cambie'],
  ['1h', '1 hora'],
  ['end_of_day', 'Hasta el fin del día'],
];

/** Estado de todo el equipo (y directorio con nombres). Se actualiza en vivo y cada minuto, por los vencimientos. */
export function useTeamPresence() {
  const queryClient = useQueryClient();
  useRealtime(['presence.changed'], () => void queryClient.invalidateQueries({ queryKey: ['presence'] }));
  return useQuery({ queryKey: ['presence'], queryFn: () => api<Presence[]>('/api/v1/presence'), staleTime: 30_000, refetchInterval: 60_000 });
}

export function useSetPresence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { status: PresenceStatus; duration: PresenceDuration }) =>
      api<Presence>('/api/v1/presence', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (mine) => queryClient.setQueryData<Presence[]>(['presence'], (list) => list?.map((p) => (p.userId === mine.userId ? mine : p)) ?? [mine]),
  });
}

export function PresenceDot({ status, className = 'size-2.5' }: { status: PresenceStatus; className?: string }) {
  return <span aria-hidden className={`inline-block shrink-0 rounded-full ${PRESENCE[status].dot} ${className}`} />;
}
