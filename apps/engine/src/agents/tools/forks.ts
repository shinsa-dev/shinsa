import {
  selectForkRepo,
  resolveTeammateFork,
  type ShinsaState,
  selectTaskByReference,
  type TeamFeedTask,
  type TeammateFork,
} from '@shinsa/core';
import { Option, Result } from 'effect';
import { TaskReferenceUnknown } from './schema.ts';

function resolveTaskId(state: ShinsaState, reference: string, purpose: string) {
  const task = selectTaskByReference(state, reference);
  if (task) return Result.succeed(task.id);
  return Result.fail(
    new TaskReferenceUnknown({
      reference,
      message: `There is no task "${reference}" to ${purpose}. Find it with find_tasks and pass its id.`,
    })
  );
}

export function resolveForkSource(state: ShinsaState, reference: string) {
  return resolveTaskId(state, reference, 'fork');
}

export function resolveStackParent(state: ShinsaState, reference: string) {
  return resolveTaskId(state, reference, 'stack on');
}

function findTeamTask(teamTasks: readonly TeamFeedTask[], reference: string) {
  const needle = reference.trim().toLowerCase();
  return (
    teamTasks.find((entry) => entry.task.id === reference.trim()) ??
    teamTasks.find((entry) => entry.task.handle?.toLowerCase() === needle) ??
    null
  );
}

export type ForkReference =
  | { kind: 'own'; forkOf: string }
  | { kind: 'teammate'; teammateFork: TeammateFork; repoId: string | null };

export function resolveForkReference(
  state: ShinsaState,
  teamTasks: readonly TeamFeedTask[],
  reference: string | null
): Result.Result<ForkReference | null, TaskReferenceUnknown> {
  if (reference === null) return Result.succeed(null);
  const entry = selectTaskByReference(state, reference) ? null : findTeamTask(teamTasks, reference);
  if (!entry)
    return Result.map(resolveForkSource(state, reference), (forkOf): ForkReference => ({
      kind: 'own',
      forkOf,
    }));
  const owner = entry.ownerProfile?.name ?? entry.owner;
  return Result.succeed({
    kind: 'teammate',
    teammateFork: resolveTeammateFork({ ...entry, owner }),
    repoId: Option.getOrNull(selectForkRepo(state, entry.repo, entry.project)),
  });
}
