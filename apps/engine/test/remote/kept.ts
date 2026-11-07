import { Effect, Layer } from 'effect';
import type { JsonFile } from '../../src/files/service.ts';
import { JsonLogger } from '../../src/log/service.ts';
import type { HeldTeamList } from '../../src/remote/team-snapshots/schema.ts';
import { makeTeamSnapshots } from '../../src/remote/team-snapshots/service.ts';
import {
  type HeldTeamView,
  TEAM_VIEWS_LIMIT,
  type TeamViewEntry,
} from '../../src/remote/team-views/schema.ts';
import { makeTeamViews } from '../../src/remote/team-views/service.ts';
import { JsonFileLayer } from '../helpers/files.ts';

const files = Layer.merge(JsonFileLayer, JsonLogger);

function runPromise<A, E>(effect: Effect.Effect<A, E, JsonFile>) {
  return Effect.runPromise(effect.pipe(Effect.provide(files)));
}

export async function openTeamSnapshots(path: string) {
  const handle = await runPromise(makeTeamSnapshots({ path }));
  return {
    list: () => runPromise(handle.list),
    select: (teamId: string, instanceId: string) => runPromise(handle.select(teamId, instanceId)),
    write: (held: HeldTeamList) => runPromise(handle.write(held)),
    remove: (teamId: string, instanceId: string) => runPromise(handle.remove(teamId, instanceId)),
  };
}

export function readTeamSnapshotsFile(path: string) {
  return runPromise(Effect.flatMap(makeTeamSnapshots({ path }), (held) => held.list));
}

export async function openTeamViews(dir: string, limit = TEAM_VIEWS_LIMIT) {
  const handle = await runPromise(makeTeamViews({ dir, limit }));
  return {
    list: () => runPromise(handle.list),
    selectEntry: (teamId: string, instanceId: string, taskId: string) =>
      runPromise(handle.selectEntry(teamId, instanceId, taskId)),
    select: (teamId: string, instanceId: string, taskId: string) =>
      runPromise(handle.select(teamId, instanceId, taskId)),
    write: (view: HeldTeamView) => runPromise(handle.write(view)),
    removeWhere: (matches: (entry: TeamViewEntry) => boolean) => runPromise(handle.removeWhere(matches)),
  };
}
