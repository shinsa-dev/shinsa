import { Effect } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import type { HeldTeamList, TeamSnapshotsHandle } from './team-snapshots/schema.ts';
import { makeTeamSnapshots } from './team-snapshots/service.ts';

export { resolveKeyDigest } from './team-snapshots/digest.ts';
export { type HeldTeamList, TEAM_SNAPSHOTS_FILE } from './team-snapshots/schema.ts';

export function readTeamSnapshotsFile(path: string): HeldTeamList[] {
  return edgeRuntime.runSync(Effect.flatMap(makeTeamSnapshots({ path }), (held) => held.list));
}

export class TeamSnapshots {
  readonly path: string;
  readonly #handle: TeamSnapshotsHandle;

  constructor(path: string) {
    this.path = path;
    this.#handle = edgeRuntime.runSync(makeTeamSnapshots({ path }));
  }

  list() {
    return edgeRuntime.runSync(this.#handle.list);
  }

  select(teamId: string, instanceId: string) {
    return edgeRuntime.runSync(this.#handle.select(teamId, instanceId));
  }

  write(held: HeldTeamList) {
    edgeRuntime.runSync(this.#handle.write(held));
  }

  remove(teamId: string, instanceId: string) {
    edgeRuntime.runSync(this.#handle.remove(teamId, instanceId));
  }
}
