import { parseTeamJoinFragment, type TeamJoinFragment, type TeamJoinStatus } from '@shinsa/core';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import type { KeyValueStore } from '@/lib/remote/devices.ts';
import type { UserProfile } from '@/lib/remote/users.ts';

const JOIN_KEY = 'shinsa.remote.team-join';

const TEAM_PREFIX = 'team:';

export interface StoredTeamKey {
  teamId: string;
  name: string;
  key: string;
  joinedAt: number;
}

export function stashTeamJoinFragment(storage: Storage, hash: string) {
  if (parseTeamJoinFragment(hash)) storage.setItem(JOIN_KEY, hash.replace(/^#/, ''));
}

export function selectTeamJoinFragment(storage: Storage): TeamJoinFragment | null {
  return parseTeamJoinFragment(storage.getItem(JOIN_KEY) ?? '');
}

export function clearTeamJoinFragment(storage: Storage) {
  storage.removeItem(JOIN_KEY);
}

function isStoredTeamKey(value: unknown): value is StoredTeamKey {
  if (value === null || typeof value !== 'object') return false;
  const fields = value as Partial<StoredTeamKey>;
  return (
    typeof fields.teamId === 'string' &&
    typeof fields.name === 'string' &&
    typeof fields.key === 'string' &&
    typeof fields.joinedAt === 'number'
  );
}

export function createTeamKeyStore(store: KeyValueStore) {
  return {
    async selectTeamKey(teamId: string) {
      const value = await store.read(`${TEAM_PREFIX}${teamId}`);
      return isStoredTeamKey(value) && value.teamId === teamId ? value : null;
    },
    writeTeamKey: (entry: StoredTeamKey) => store.write(`${TEAM_PREFIX}${entry.teamId}`, entry),
  };
}

export type TeamKeyStore = ReturnType<typeof createTeamKeyStore>;

export interface TeamJoinResult {
  name: string;
  owner: UserProfile;
  status: TeamJoinStatus;
}

export async function requestTeamJoin(
  fragment: TeamJoinFragment,
  options: {
    dashboard: Pick<DashboardClient, 'joinTeam'>;
    teamKeys: Pick<TeamKeyStore, 'selectTeamKey' | 'writeTeamKey'>;
    now?: () => number;
  }
): Promise<TeamJoinResult> {
  const answer = await options.dashboard.joinTeam(fragment.invite);
  if (answer.teamId !== fragment.teamId)
    throw new Error('This team link does not match its team. Ask the team’s owner for a new one.');
  const earlier = await options.teamKeys.selectTeamKey(answer.teamId);
  await options.teamKeys.writeTeamKey({
    teamId: answer.teamId,
    name: answer.name,
    key: fragment.key,
    joinedAt: earlier?.joinedAt ?? (options.now ?? Date.now)(),
  });
  return { name: answer.name, owner: answer.owner, status: answer.status };
}
