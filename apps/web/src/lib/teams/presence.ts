import type {
  TeamFeedMachine,
  TeamFeedSnapshot,
  TeamMachine,
  TeamPresence,
  TeamPresenceStatus,
} from '@shinsa/core';
import { formatSince } from '@/lib/format/time.ts';

export const PRESENCE_LABELS: Record<TeamPresenceStatus, string> = {
  online: 'Online',
  away: 'Away',
  offline: 'Offline',
};

export const PRESENCE_DOT: Record<TeamPresenceStatus, string> = {
  online: 'bg-green-4',
  away: 'bg-amber-4',
  offline: 'bg-fg-1',
};

export function describePresence(presence: TeamPresence, now = Date.now()) {
  if (presence.status === 'online' || presence.seenAt === null) return null;
  return formatSince('Seen', presence.seenAt, now);
}

export function selectFeedMachine(feed: TeamFeedSnapshot, teamId: string, instanceId: string) {
  return (
    feed.machines.find((machine) => machine.teamId === teamId && machine.instanceId === instanceId) ?? null
  );
}

export function isMachineOnline(machine: TeamMachine, live: TeamFeedMachine | null) {
  if (!live || live.status === 'connecting') return machine.online;
  return live.status === 'live';
}

export function resolveMachineSeenAt(machine: TeamMachine, live: TeamFeedMachine | null) {
  const seen = [machine.lastSeenAt, live?.updatedAt ?? null].filter((at): at is number => at !== null);
  return seen.length === 0 ? null : Math.max(...seen);
}

export function markViewerPresent(
  presence: ReadonlyMap<string, TeamPresence>,
  viewerId: string | null,
  now: number
): ReadonlyMap<string, TeamPresence> {
  const known = viewerId === null ? undefined : presence.get(viewerId);
  if (viewerId === null || !known || known.status === 'online') return presence;
  return new Map(presence).set(viewerId, { userId: viewerId, status: 'online', seenAt: now });
}
