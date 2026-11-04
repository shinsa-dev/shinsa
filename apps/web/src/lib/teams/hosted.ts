import { Effect } from 'effect';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import { runApp } from '@/lib/runtime/app.ts';
import type { TeamKeyStore } from './join.ts';
import type { HostedTeams } from './settings.ts';

export function listHostedTeams(options: {
  dashboard: Pick<DashboardClient, 'listTeams' | 'readSession'>;
  teamKeys: Pick<TeamKeyStore, 'selectTeamKey'>;
}): Promise<HostedTeams> {
  return runApp(
    Effect.gen(function* () {
      const [teams, session] = yield* Effect.all(
        [
          Effect.promise(() => options.dashboard.listTeams()),
          Effect.promise(() => options.dashboard.readSession()),
        ],
        { concurrency: 'unbounded' }
      );
      const keys = yield* Effect.forEach(
        teams,
        (team) => Effect.promise(() => options.teamKeys.selectTeamKey(team.id)),
        { concurrency: 'unbounded' }
      );
      return {
        viewerId: session.user?.id ?? null,
        teams: teams.map((team, index) => ({ team, hasKey: keys[index] !== null })),
      };
    })
  );
}
