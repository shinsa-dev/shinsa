import {
  selectForkRepo,
  hasEngineFeature,
  listOwnRepos,
  resolveTaskProject,
  resolveTeammateFork,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { Option } from 'effect';
import { useSyncExternalStore } from 'react';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { connection, type TeammateMachine } from '@/lib/connection/socket.ts';
import { createSignal } from '@/lib/signal.ts';

export const FORK_TITLE = 'Fork into a new task';

export const FORK_DESCRIPTION =
  'The new task gets its own branch and pull request, and its agent starts from a copy of this conversation.';

export function describeTeammateFork(owner: string) {
  return `The new task runs on your machine and starts from what ${owner}’s task was asked and did.`;
}

export const NO_FORK_REPO = 'Add this repository on one of your machines first, then fork the task there.';

export const NO_FORK_ENGINE = 'Update Shinsa on your machine first, then fork the task there.';

type ForkTarget = (repoId: string) => boolean;

export function canForkOnto(repoId: string) {
  return hasEngineFeature(
    connection.selectEngine(connection.selectMachine(repoId)?.id ?? null),
    'team-access'
  );
}

export function listForkRepos(state: ShinsaState, canFork: ForkTarget = canForkOnto) {
  return listOwnRepos(state).filter((repo) => canFork(repo.id));
}

export function describeForkBlock(state: ShinsaState, canFork: ForkTarget = canForkOnto) {
  return listOwnRepos(state).length > 0 && listForkRepos(state, canFork).length === 0
    ? NO_FORK_ENGINE
    : NO_FORK_REPO;
}

export function resolveOwnerName(teammate: TeammateMachine) {
  return teammate.owner.name ?? teammate.owner.login;
}

const forkSignal = createSignal();

let forking: string | null = null;

export function openForkDialog(taskId: string) {
  forking = taskId;
  forkSignal.publish();
}

export function closeForkDialog() {
  forking = null;
  forkSignal.publish();
}

export function useForkDialog() {
  return useSyncExternalStore(forkSignal.subscribe, () => forking);
}

export function forkTask(state: ShinsaState, task: Task, request: string) {
  const projectId = Option.getOrNull(resolveTaskProject(state, task));
  return sendCommandWithToast(
    { type: 'task.create', request, repoId: task.repoId, projectId, forkOf: task.id },
    `Forked ${task.handle ?? task.title} into a new task.`
  );
}

export function resolveForkRepo(state: ShinsaState, task: Task, canFork: ForkTarget = canForkOnto) {
  const repo = task.repoId ? state.repos[task.repoId] : undefined;
  const match = Option.getOrNull(selectForkRepo(state, repo ?? null, null));
  if (match && canFork(match)) return match;
  return listForkRepos(state, canFork)[0]?.id ?? null;
}

export function forkTeammateTask(
  state: ShinsaState,
  task: Task,
  request: string,
  repoId: string,
  machine: { id: string; teammate: TeammateMachine }
) {
  const target = connection.selectMachine(repoId);
  const teammateFork = resolveTeammateFork({
    instanceId: machine.id,
    task,
    owner: resolveOwnerName(machine.teammate),
  });
  return sendCommandWithToast(
    {
      type: 'task.create',
      request,
      repoId,
      projectId: state.repos[repoId]?.projectId ?? null,
      teammateFork,
    },
    `Forked ${task.handle ?? task.title} onto ${target?.name ?? 'your machine'}.`,
    target?.id ?? null
  );
}
