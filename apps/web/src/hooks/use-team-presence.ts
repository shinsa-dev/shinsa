import { resolveTeamPresence } from '@shinsa/core';
import * as React from 'react';
import { useTeamFeed } from '@/lib/connection/socket.ts';

export function useTeamPresence(teamId: string | null = null) {
  const feed = useTeamFeed();
  return React.useMemo(() => resolveTeamPresence(feed, teamId), [feed, teamId]);
}

export function usePersonPresence(userId: string | null) {
  const presence = useTeamPresence();
  return userId === null ? null : (presence.get(userId) ?? null);
}
