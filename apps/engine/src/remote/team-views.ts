import { edgeRuntime } from '../runtime/edge.ts';
import {
  type HeldTeamView,
  TEAM_VIEWS_LIMIT,
  type TeamViewEntry,
  type TeamViewsHandle,
} from './team-views/schema.ts';
import { makeTeamViews } from './team-views/service.ts';

export { TeamViewRecorder } from './team-views/recorder.ts';
export {
  type HeldTeamView,
  TEAM_VIEWS_DIR,
  TEAM_VIEWS_LIMIT,
  type TeamViewEntry,
} from './team-views/schema.ts';

export class TeamViews {
  readonly dir: string;
  readonly #handle: TeamViewsHandle;

  constructor(dir: string, limit = TEAM_VIEWS_LIMIT) {
    this.dir = dir;
    this.#handle = edgeRuntime.runSync(makeTeamViews({ dir, limit }));
  }

  list() {
    return edgeRuntime.runSync(this.#handle.list);
  }

  selectEntry(teamId: string, instanceId: string, taskId: string) {
    return edgeRuntime.runSync(this.#handle.selectEntry(teamId, instanceId, taskId));
  }

  select(teamId: string, instanceId: string, taskId: string) {
    return edgeRuntime.runSync(this.#handle.select(teamId, instanceId, taskId));
  }

  write(view: HeldTeamView) {
    edgeRuntime.runSync(this.#handle.write(view));
  }

  removeWhere(matches: (entry: TeamViewEntry) => boolean) {
    edgeRuntime.runSync(this.#handle.removeWhere(matches));
  }
}
