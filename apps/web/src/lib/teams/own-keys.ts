import { Effect } from 'effect';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import type { MachineRow } from '@/lib/remote/machines.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { enterPromise } from '@/lib/runtime/promise.ts';
import { createJoinMember, listJoinRows, onMachine } from './join-machines.ts';
import type { TeamKeyStore } from './join.ts';
import { PROJECTS_TIMEOUT } from './schema.ts';

type OwnKeysRow = Parameters<typeof createJoinMember>[0];

export interface OwnTeamKeysOptions {
  dashboard: Pick<DashboardClient, 'requestConnect'>;
  teamKeys: Pick<TeamKeyStore, 'selectTeamKey' | 'writeTeamKey'>;
  origin?: string;
  now?: () => number;
  createMember?: (
    row: OwnKeysRow,
    dashboard: Pick<DashboardClient, 'requestConnect'>
  ) => ReturnType<typeof createJoinMember>;
}

const readKeys = Effect.fn('OwnTeamKeys.read')(function* () {
  const engine = yield* EngineClient;
  return (yield* engine.teams.keys()).keys;
});

export function syncOwnTeamKeys(rows: readonly MachineRow[], options: OwnTeamKeysOptions) {
  const createMember = options.createMember ?? createJoinMember;
  const origin = options.origin ?? location.origin;
  const sync = Effect.fn('OwnTeamKeys.sync')(function* () {
    const found = yield* Effect.forEach(
      listJoinRows(rows),
      (row) =>
        Effect.acquireUseRelease(
          Effect.sync(() => createMember(row, options.dashboard)),
          (entry) =>
            onMachine(
              entry.member,
              origin
            )(readKeys()).pipe(
              Effect.timeout(PROJECTS_TIMEOUT),
              Effect.orElseSucceed(() => [])
            ),
          (entry) => Effect.sync(entry.close)
        ),
      { concurrency: 'unbounded' }
    );
    const keys = new Map(found.flat().map((entry) => [entry.teamId, entry]));
    let added = 0;
    for (const entry of keys.values()) {
      const earlier = yield* enterPromise(() => options.teamKeys.selectTeamKey(entry.teamId));
      if (earlier?.key === entry.key) continue;
      yield* enterPromise(() =>
        options.teamKeys.writeTeamKey({
          teamId: entry.teamId,
          name: entry.name,
          key: entry.key,
          joinedAt: earlier?.joinedAt ?? (options.now ?? Date.now)(),
        })
      );
      added += 1;
    }
    return added;
  });
  return runApp(sync().pipe(Effect.orElseSucceed(() => 0)));
}
