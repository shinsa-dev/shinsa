import {
  isTaskSettled,
  listOwnRepos,
  type Repo,
  resolveMoveRefusal,
  resolveTaskProject,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { Option } from 'effect';
import { useSyncExternalStore } from 'react';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { createSignal } from '@/lib/signal.ts';

export const MOVE_TITLE = 'Move to another repository';

export const MOVE_DESCRIPTION =
  'The agent stops and starts the current step again in the repository you pick.';

export interface MoveChoice {
  repo: Repo;
  hint: string;
}

const moveSignal = createSignal();

let moving: string | null = null;

export function openMoveDialog(taskId: string) {
  moving = taskId;
  moveSignal.publish();
}

export function closeMoveDialog() {
  moving = null;
  moveSignal.publish();
}

export function useMoveDialog() {
  return useSyncExternalStore(moveSignal.subscribe, () => moving);
}

function resolveProjectName(state: ShinsaState, repo: Repo) {
  return (repo.projectId ? state.projects[repo.projectId]?.name : undefined) ?? 'No project';
}

export function listMoveChoices(state: ShinsaState, task: Task): MoveChoice[] {
  const projectId = Option.getOrNull(resolveTaskProject(state, task));
  const candidates = listOwnRepos(state).filter((repo) => repo.id !== task.repoId);
  const byName = (a: Repo, b: Repo) => a.name.localeCompare(b.name);
  const own = candidates.filter((repo) => repo.projectId === projectId).sort(byName);
  const others = candidates
    .filter((repo) => repo.projectId !== projectId)
    .sort((a, b) => resolveProjectName(state, a).localeCompare(resolveProjectName(state, b)) || byName(a, b));
  return [
    ...own.map((repo) => ({ repo, hint: 'This project' })),
    ...others.map((repo) => ({ repo, hint: `Moves to ${resolveProjectName(state, repo)}` })),
  ];
}

export function isTaskMovable(state: ShinsaState, task: Task) {
  return (
    task.repoId !== null &&
    !isTaskSettled(task) &&
    Option.isNone(resolveMoveRefusal(state, task, 'you')) &&
    listMoveChoices(state, task).length > 0
  );
}

export function resolveMoveChoiceValue(state: ShinsaState, repo: Repo) {
  return `${repo.name} ${resolveProjectName(state, repo)} ${repo.id}`;
}

export function moveTask(task: Task, repo: Repo) {
  return sendCommandWithToast(
    { type: 'task.move_to_repository', taskId: task.id, repoId: repo.id },
    `Moving to ${repo.name}.`
  );
}
