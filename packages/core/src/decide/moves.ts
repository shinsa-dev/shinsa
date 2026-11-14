import { Option } from 'effect';
import type { CommandOf } from '../commands/index.ts';
import { DomainError, isPausingGate, isTaskSettled, type Repo, type Task } from '../domain/index.ts';
import { resolveNextHandle } from '../state/project.ts';
import {
  findRepo,
  MOVE_REFUSAL_TEXT,
  resolveMoveRefusal,
  resolveTaskProject,
  type MoveActor,
} from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { startWork } from './lifecycle.ts';
import { findCurrentRun } from './runs.ts';

function assertMovable(decider: Decider, task: Task, repo: Repo, actor: MoveActor) {
  if (repo.id === task.repoId) {
    throw new DomainError({
      code: 'same_repository',
      message: 'This task already works in that repository.',
    });
  }
  const refusal = resolveMoveRefusal(decider.state, task, actor);
  if (Option.isSome(refusal)) {
    throw new DomainError({ code: refusal.value, message: MOVE_REFUSAL_TEXT[refusal.value] });
  }
}

function startMove(decider: Decider, task: Task, repo: Repo, reason: string, runId: string | null) {
  decider.emit({
    type: 'task.moving',
    taskId: task.id,
    repoId: repo.id,
    reason,
    ...(runId ? { runId } : {}),
  });
  decider.stage(task.id, 'triage', `moving to ${repo.name}`);
  if (task.worktreePath === null) {
    finishMove(decider, task.id);
    return;
  }
  decider.run({ kind: 'worktree.remove', taskId: task.id });
}

export function moveToRepository(decider: Decider, command: CommandOf<'agent.move_to_repository'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'move_to_repository');
  const repo = findRepo(decider.state, command.repoId);
  assertMovable(decider, task, repo, 'agent');
  decider.endRun(run, 'completed', command.reason);
  startMove(decider, task, repo, command.reason, run.id);
}

export function moveTaskToRepository(decider: Decider, command: CommandOf<'task.move_to_repository'>) {
  const task = decider.task(command.taskId);
  if (isTaskSettled(task)) {
    throw new DomainError({
      code: 'task_settled',
      message: 'This task is finished, so it stays where it is.',
    });
  }
  const repo = findRepo(decider.state, command.repoId);
  assertMovable(decider, task, repo, 'you');
  decider.cancelRuns(task.id);
  decider.clearWaits(task.id);
  decider.withdrawGates(task.id, () => true);
  startMove(decider, task, repo, '', null);
}

function resolveMovedProject(decider: Decider, task: Task, repoId: string) {
  const projectId = decider.state.repos[repoId]?.projectId ?? null;
  if (!projectId || Option.contains(resolveTaskProject(decider.state, task), projectId)) return {};
  return { projectId, handle: resolveNextHandle(decider.state, projectId) };
}

export function finishMove(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  if (!task.movingTo) return;
  decider.emit({
    type: 'task.moved',
    taskId,
    repoId: task.movingTo,
    ...resolveMovedProject(decider, task, task.movingTo),
  });
  if (decider.hasOpenGate(taskId, isPausingGate)) return;
  startWork(decider, taskId);
}
