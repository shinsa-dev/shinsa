import { parseTeamJoinFragment, type TeamJoinFragment, type TeamJoinStatus } from '@shinsa/core';
import { Clock, Effect, Schema } from 'effect';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import type { KeyValueStore } from '@/lib/remote/schema.ts';
import type { UserProfile } from '@/lib/remote/users.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { StoredTeamKey, TEAM_LINK_MISMATCH, TeamLinkMismatch } from './schema.ts';

const JOIN_KEY = 'shinsa.remote.team-join';

const TEAM_PREFIX = 'team:';

export function stashTeamJoinFragment(storage: Storage, hash: string) {
  if (parseTeamJoinFragment(hash)) storage.setItem(JOIN_KEY, hash.replace(/^#/, ''));
}

export function selectTeamJoinFragment(storage: Storage): TeamJoinFragment | null {
  return parseTeamJoinFragment(storage.getItem(JOIN_KEY) ?? '');
}

export function clearTeamJoinFragment(storage: Storage) {
  storage.removeItem(JOIN_KEY);
}

export function createTeamKeyStore(store: KeyValueStore) {
  const isStoredTeamKey = Schema.is(StoredTeamKey);
  return {
    selectTeamKey: (teamId: string) =>
      runApp(
        Effect.map(
          Effect.promise(() => store.read(`${TEAM_PREFIX}${teamId}`)),
          (value) => (isStoredTeamKey(value) && value.teamId === teamId ? value : null)
        )
      ),
    writeTeamKey: (entry: StoredTeamKey) => store.write(`${TEAM_PREFIX}${entry.teamId}`, entry),
  };
}

export type TeamKeyStore = ReturnType<typeof createTeamKeyStore>;

export interface TeamJoinResult {
  name: string;
  owner: UserProfile;
  status: TeamJoinStatus;
}

const joinTeam = Effect.fn('TeamJoin.request')(function* (
  fragment: TeamJoinFragment,
  options: {
    dashboard: Pick<DashboardClient, 'joinTeam'>;
    teamKeys: Pick<TeamKeyStore, 'selectTeamKey' | 'writeTeamKey'>;
    now?: () => number;
  }
) {
  const answer = yield* Effect.promise(() => options.dashboard.joinTeam(fragment.invite));
  if (answer.teamId !== fragment.teamId) return yield* new TeamLinkMismatch({ message: TEAM_LINK_MISMATCH });
  const earlier = yield* Effect.promise(() => options.teamKeys.selectTeamKey(answer.teamId));
  const now = options.now?.() ?? (yield* Clock.currentTimeMillis);
  yield* Effect.promise(() =>
    options.teamKeys.writeTeamKey({
      teamId: answer.teamId,
      name: answer.name,
      key: fragment.key,
      joinedAt: earlier?.joinedAt ?? now,
    })
  );
  const result: TeamJoinResult = { name: answer.name, owner: answer.owner, status: answer.status };
  return result;
});

export function requestTeamJoin(...input: Parameters<typeof joinTeam>) {
  return runApp(joinTeam(...input));
}
