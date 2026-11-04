import { Effect, Layer } from 'effect';
import { JsonFile } from '../../src/files/service.ts';
import { JsonLogger } from '../../src/log/service.ts';
import type { HeldTeamList } from '../../src/remote/team-snapshots/schema.ts';
import { makeTeamSnapshots } from '../../src/remote/team-snapshots/service.ts';
import {
  type HeldTeamView,
  TEAM_VIEWS_LIMIT,
  type TeamViewEntry,
} from '../../src/remote/team-views/schema.ts';
import { makeTeamViews } from '../../src/remote/team-views/service.ts';

const files = Layer.merge(JsonFile.layer, JsonLogger);

function runSync<A, E>(effect: Effect.Effect<A, E, JsonFile>) {
  return Effect.runSync(effect.pipe(Effect.provide(files)));
}

export function openTeamSnapshots(path: string) {
  const handle = runSync(makeTeamSnapshots({ path }));
  return {
    list: () => runSync(handle.list),
    select: (teamId: string, instanceId: string) => runSync(handle.select(teamId, instanceId)),
    write: (held: HeldTeamList) => runSync(handle.write(held)),
    remove: (teamId: string, instanceId: string) => runSync(handle.remove(teamId, instanceId)),
  };
}

export function readTeamSnapshotsFile(path: string) {
  return runSync(Effect.flatMap(makeTeamSnapshots({ path }), (held) => held.list));
}

export function openTeamViews(dir: string, limit = TEAM_VIEWS_LIMIT) {
  const handle = runSync(makeTeamViews({ dir, limit }));
  return {
    list: () => runSync(handle.list),
    selectEntry: (teamId: string, instanceId: string, taskId: string) =>
      runSync(handle.selectEntry(teamId, instanceId, taskId)),
    select: (teamId: string, instanceId: string, taskId: string) =>
      runSync(handle.select(teamId, instanceId, taskId)),
    write: (view: HeldTeamView) => runSync(handle.write(view)),
    removeWhere: (matches: (entry: TeamViewEntry) => boolean) => runSync(handle.removeWhere(matches)),
  };
}
