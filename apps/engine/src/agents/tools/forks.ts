import {
  findForkRepo,
  resolveTeammateFork,
  type ShinsaState,
  selectTaskByReference,
  type TeamFeedTask,
  type TeammateFork,
} from '@shinsa/core';

export function findForkSource(state: ShinsaState, reference: string) {
  const task = selectTaskByReference(state, reference);
  if (task) return task.id;
  throw new Error(`There is no task "${reference}" to fork. Find it with find_tasks and pass its id.`);
}

export function findStackParent(state: ShinsaState, reference: string) {
  const task = selectTaskByReference(state, reference);
  if (task) return task.id;
  throw new Error(`There is no task "${reference}" to stack on. Find it with find_tasks and pass its id.`);
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
): ForkReference | null {
  if (reference === null) return null;
  const own = selectTaskByReference(state, reference);
  if (own) return { kind: 'own', forkOf: own.id };
  const entry = findTeamTask(teamTasks, reference);
  if (!entry) return { kind: 'own', forkOf: findForkSource(state, reference) };
  const owner = entry.ownerProfile?.name ?? entry.owner;
  return {
    kind: 'teammate',
    teammateFork: resolveTeammateFork({ ...entry, owner }),
    repoId: findForkRepo(state, entry.repo, entry.project),
  };
}
