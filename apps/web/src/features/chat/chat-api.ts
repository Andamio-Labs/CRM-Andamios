import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api';
import { useRealtime } from '../../shared/realtime';

export type ChatKind = 'general' | 'direct' | 'group' | 'notes';

export interface TeamChat {
  id: string;
  kind: ChatKind;
  title: string;
  dealId: string | null;
  dealTitle: string | null;
  members: { userId: string; name: string }[];
  unread: number;
  lastMessageAt: string | null;
  lastMessage: { body: string; deleted: boolean; authorName: string | null } | null;
}

export interface TeamMessage {
  id: string;
  body: string;
  deleted: boolean;
  authorId: string | null;
  authorName?: string | null;
  createdAt: string;
  mine: boolean;
  canDelete: boolean;
}

/**
 * E12-S03 — Chats del equipo. El tiempo real solo avisa "hay algo nuevo en el chat X" (sin contenido):
 * se vuelve a pedir la lista y, si está abierto, ese chat.
 */
export function useTeamChats() {
  const queryClient = useQueryClient();
  useRealtime(['team.message'], (payload) => {
    void queryClient.invalidateQueries({ queryKey: ['team-chats'] });
    if (typeof payload.chatId === 'string') void queryClient.invalidateQueries({ queryKey: ['team-messages', payload.chatId] });
  });
  return useQuery({ queryKey: ['team-chats'], queryFn: () => api<TeamChat[]>('/api/v1/team-chats'), staleTime: 30_000 });
}

/** Mensajes sin leer en todos tus chats: el número del menú lateral. */
export function useTeamChatUnread() {
  const chats = useTeamChats();
  return chats.data?.reduce((sum, chat) => sum + chat.unread, 0) ?? 0;
}
