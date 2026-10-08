import { useQuery } from '@tanstack/react-query';
import type { TeamRole } from '../features/team/roles';
import { api, ApiError } from './api';
import { authClient } from './auth-client';

/** Rol de la persona en la empresa. Ver el equipo requiere members:read: un 403 significa vendedor. */
export function useMyRole(): TeamRole | undefined {
  const session = authClient.useSession();
  const members = useQuery({
    queryKey: ['members'],
    queryFn: () => api<{ userId: string; role: TeamRole }[]>('/api/v1/members'),
    retry: false,
    staleTime: 60_000,
  });
  if (members.error instanceof ApiError && members.error.status === 403) return 'member';
  return members.data?.find((m) => m.userId === session.data?.user.id)?.role;
}
