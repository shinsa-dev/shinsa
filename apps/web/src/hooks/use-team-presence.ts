import { resolveTeamPresence } from '@shinsa/core';
import * as React from 'react';
import { useRemoteSnapshot, useTeamFeed } from '@/lib/connection/socket.ts';
import { markViewerPresent } from '@/lib/teams/presence.ts';

export function useTeamPresence(teamId: string | null = null) {
  const feed = useTeamFeed();
  const viewerId = useRemoteSnapshot()?.access?.owner.id ?? null;
  return React.useMemo(
    () => markViewerPresent(resolveTeamPresence(feed, teamId), viewerId, Date.now()),
    [feed, teamId, viewerId]
  );
}

export function usePersonPresence(userId: string | null) {
  const presence = useTeamPresence();
  return userId === null ? null : (presence.get(userId) ?? null);
}
