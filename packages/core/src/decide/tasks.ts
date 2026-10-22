import type { CommandOf } from '../commands/index.ts';
import { DomainError, isTaskSettled } from '../model/index.ts';
import { isDependencyOf, listPendingDependencies } from '../state/queries.ts';
import { type Decider, quoteTitles } from './decider.ts';
import { changeDependencies, resolveDependencies } from './dependencies.ts';
import { settleTask, startPlanning, startWork } from './lifecycle.ts';
import { retryTask } from './retry.ts';

function assertRepo(decider: Decider, repoId: string | null) {
  if (repoId !== null && !decider.state.repos[repoId]) {
    throw new DomainError('repo_not_found', `No repository ${repoId}`);
  }
}

export function createTask(decider: Decider, command: CommandOf<'task.create'>) {
  const intent = command.intent.trim();
  if (intent.length === 0) throw new DomainError('intent_required', 'Describe what you want done.');
  assertRepo(decider, command.repoId);
  const blockedBy = resolveDependencies(decider, null, command.blockedBy ?? []);
  const taskId = decider.context.newId();
  decider.emit({
    type: 'task.created',
    taskId,
    intent,
    repoId: command.repoId,
    priority: command.priority ?? 'normal',
    specFirst: command.specFirst ?? false,
    origin: command.origin ?? null,
  });
  if (blockedBy.length > 0) decider.emit({ type: 'task.blocked', taskId, blockedBy, by: 'you' });
  decider.run({ kind: 'task.triage', taskId });
}

function inferDependencies(decider: Decider, taskId: string, ids: string[]) {
  return [...new Set(ids)].filter((id) => {
    const dependency = decider.state.tasks[id];
    return (
      dependency !== undefined &&
      id !== taskId &&
      !isTaskSettled(dependency) &&
      !isDependencyOf(decider.state, taskId, id)
    );
  });
}

export function triageTask(decider: Decider, command: CommandOf<'task.triage'>) {
  const task = decider.task(command.taskId);
  if (isTaskSettled(task) || task.branch !== null) return;
  assertRepo(decider, command.repoId);
  decider.emit({
    type: 'task.triaged',
    taskId: task.id,
    title: command.title,
    repoId: command.repoId,
    size: command.size,
    branch: command.branch,
  });
  const inferred = task.blockedBy.length === 0 ? inferDependencies(decider, task.id, command.dependsOn) : [];
  if (inferred.length > 0) {
    decider.emit({ type: 'task.blocked', taskId: task.id, blockedBy: inferred, by: 'shinsa' });
  }
  startWork(decider, task.id);
}

export function prioritizeTask(decider: Decider, command: CommandOf<'task.prioritize'>) {
  if (decider.task(command.taskId).priority === command.priority) return;
  decider.emit({ type: 'task.prioritized', taskId: command.taskId, priority: command.priority });
  decider.requestBriefing(command.taskId);
}

export function blockTask(decider: Decider, command: CommandOf<'task.block'>) {
  const task = decider.task(command.taskId);
  if (isTaskSettled(task)) throw new DomainError('task_settled', 'This task is finished.');
  changeDependencies(decider, task.id, resolveDependencies(decider, task, command.blockedBy), 'you');
}

export function cancelTask(decider: Decider, command: CommandOf<'task.cancel'>) {
  settleTask(decider, command.taskId, 'cancelled', 'cancelled by you');
}

export function completeTask(decider: Decider, command: CommandOf<'task.complete'>) {
  settleTask(decider, command.taskId, 'done', 'marked done by you');
}

export function retryTaskCommand(decider: Decider, command: CommandOf<'task.retry'>) {
  decider.progressed(command.taskId);
  retryTask(decider, command.taskId, null);
}

export function readyWorktree(decider: Decider, command: CommandOf<'worktree.ready'>) {
  decider.task(command.taskId);
  decider.emit({
    type: 'worktree.created',
    taskId: command.taskId,
    path: command.path,
    branch: command.branch,
  });
  const task = decider.task(command.taskId);
  if (isTaskSettled(task)) {
    decider.run({ kind: 'worktree.remove', taskId: task.id });
    return;
  }
  if (task.stage !== 'triage') return;
  const pending = listPendingDependencies(decider.state, task);
  if (pending.length > 0) {
    decider.stage(task.id, 'queued', `waiting for ${quoteTitles(pending)} to finish`);
    return;
  }
  startPlanning(decider, task.id, null);
}

export function removeWorktree(decider: Decider, command: CommandOf<'worktree.gone'>) {
  if (decider.task(command.taskId).worktreePath === null) return;
  decider.emit({ type: 'worktree.removed', taskId: command.taskId });
}

export function failEffect(decider: Decider, command: CommandOf<'effect.fail'>) {
  decider.fail(command.taskId, command.title, command.detail);
}
