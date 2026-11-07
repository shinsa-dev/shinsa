import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  isLaterRound,
  isPausingGate,
  isTaskSettled,
  type Repo,
  type Task,
} from '../domain/index.ts';
import type { ShinsaState } from '../state/project.ts';
import { findRepo, listStackChildren, resolveTaskProject } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { startWork } from './lifecycle.ts';
import { findCurrentRun } from './runs.ts';

const FILE_INSTEAD = 'File the work there with `create_task` instead.';

function refuse(code: string, message: string): never {
  throw new DomainError({ code, message });
}

function assertMovable(state: ShinsaState, task: Task, repo: Repo) {
  if (repo.id === task.repoId) refuse('same_repository', 'This task already works in that repository.');
  if (repo.projectId !== resolveTaskProject(state, task)) {
    refuse(
      'other_project',
      `${repo.name} belongs to another project, so this task cannot move there. ${FILE_INSTEAD}`
    );
  }
  if (task.phaseReports.length > 0 || task.pullRequest !== null || isLaterRound(task)) {
    refuse('work_started', `Work on this task has already started, so it stays where it is. ${FILE_INSTEAD}`);
  }
  if ((task.stacksOn?.length ?? 0) > 0 || listStackChildren(state, task.id).length > 0) {
    refuse(
      'task_stacked',
      `This task is part of a bundle in its repository, so it stays there. ${FILE_INSTEAD}`
    );
  }
}

export function moveToRepository(decider: Decider, command: CommandOf<'agent.move_to_repository'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'move_to_repository');
  const repo = findRepo(decider.state, command.repoId);
  assertMovable(decider.state, task, repo);
  decider.endRun(run, 'completed', command.reason);
  decider.emit({
    type: 'task.moving',
    taskId: task.id,
    repoId: repo.id,
    runId: run.id,
    reason: command.reason,
  });
  decider.stage(task.id, 'triage', `moving to ${repo.name}`);
  if (task.worktreePath === null) {
    finishMove(decider, task.id);
    return;
  }
  decider.run({ kind: 'worktree.remove', taskId: task.id });
}

export function finishMove(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  if (!task.movingTo) return;
  decider.emit({ type: 'task.moved', taskId, repoId: task.movingTo });
  if (isTaskSettled(task) || decider.hasOpenGate(taskId, isPausingGate)) return;
  startWork(decider, taskId);
}
