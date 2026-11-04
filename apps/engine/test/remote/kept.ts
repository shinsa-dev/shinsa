import { Effect } from 'effect';
import type { HeldTeamList } from '../../src/remote/team-snapshots/schema.ts';
import { makeTeamSnapshots } from '../../src/remote/team-snapshots/service.ts';
import {
  type HeldTeamView,
  TEAM_VIEWS_LIMIT,
  type TeamViewEntry,
} from '../../src/remote/team-views/schema.ts';
import { makeTeamViews } from '../../src/remote/team-views/service.ts';
import { edgeRuntime } from '../../src/runtime/edge.ts';

export function openTeamSnapshots(path: string) {
  const handle = edgeRuntime.runSync(makeTeamSnapshots({ path }));
  return {
    list: () => edgeRuntime.runSync(handle.list),
    select: (teamId: string, instanceId: string) => edgeRuntime.runSync(handle.select(teamId, instanceId)),
    write: (held: HeldTeamList) => edgeRuntime.runSync(handle.write(held)),
    remove: (teamId: string, instanceId: string) => edgeRuntime.runSync(handle.remove(teamId, instanceId)),
  };
}

export function readTeamSnapshotsFile(path: string) {
  return edgeRuntime.runSync(Effect.flatMap(makeTeamSnapshots({ path }), (held) => held.list));
}

export function openTeamViews(dir: string, limit = TEAM_VIEWS_LIMIT) {
  const handle = edgeRuntime.runSync(makeTeamViews({ dir, limit }));
  return {
    list: () => edgeRuntime.runSync(handle.list),
    selectEntry: (teamId: string, instanceId: string, taskId: string) =>
      edgeRuntime.runSync(handle.selectEntry(teamId, instanceId, taskId)),
    select: (teamId: string, instanceId: string, taskId: string) =>
      edgeRuntime.runSync(handle.select(teamId, instanceId, taskId)),
    write: (view: HeldTeamView) => edgeRuntime.runSync(handle.write(view)),
    removeWhere: (matches: (entry: TeamViewEntry) => boolean) =>
      edgeRuntime.runSync(handle.removeWhere(matches)),
  };
}
