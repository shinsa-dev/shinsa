import {
  listStackParents,
  listWaitsOn,
  type Project,
  type Repo,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { selectProject } from '@/lib/projects.ts';
import { isHeldByTasks } from '@/lib/tasks/groups.ts';
import { resolveTaskStatus, type Status } from '@/lib/tasks/status.ts';

export interface TaskRowModel {
  task: Task;
  depth: number;
  repo: Repo | null;
  project: Project | null;
  status: Status;
  waitsOn: readonly Task[];
  stacked: boolean;
  stackParents: readonly Task[];
  chainOthers: readonly Task[];
}

const NO_TASKS: readonly Task[] = [];

function resolveChain(state: ShinsaState, task: Task, depth: number) {
  if (depth === 0) return { stackParents: NO_TASKS, chainOthers: NO_TASKS };
  const stackParents = listStackParents(state, task);
  const stacked = new Set(stackParents.map((parent) => parent.id));
  const chainOthers = listWaitsOn(state, task).filter((waited) => !stacked.has(waited.id));
  return { stackParents, chainOthers };
}

export function resolveTaskRowModel(state: ShinsaState, task: Task, depth = 0): TaskRowModel {
  const repo = task.repoId ? (state.repos[task.repoId] ?? null) : null;
  const waitsOn = isHeldByTasks(state, task) ? listWaitsOn(state, task) : NO_TASKS;
  return {
    task,
    depth,
    repo,
    project: repo ? selectProject(state, repo.projectId) : null,
    status: resolveTaskStatus(state, task),
    waitsOn,
    stacked: waitsOn.length > 0 && waitsOn.every((parent) => task.stacksOn?.includes(parent.id)),
    ...resolveChain(state, task, depth),
  };
}

function isSameTasks(left: readonly Task[], right: readonly Task[]) {
  return left.length === right.length && left.every((task, index) => task === right[index]);
}

export function isSameTaskRowModel(left: TaskRowModel, right: TaskRowModel) {
  return (
    left.task === right.task &&
    left.depth === right.depth &&
    left.repo === right.repo &&
    left.project === right.project &&
    left.status.label === right.status.label &&
    left.status.tone === right.status.tone &&
    left.stacked === right.stacked &&
    isSameTasks(left.waitsOn, right.waitsOn) &&
    isSameTasks(left.stackParents, right.stackParents) &&
    isSameTasks(left.chainOthers, right.chainOthers)
  );
}
