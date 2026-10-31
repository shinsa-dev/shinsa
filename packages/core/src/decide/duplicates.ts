import type { CommandOf } from '../commands/index.ts';
import { DomainError, type DuplicateActor, isTaskSettled, type Task } from '../domain/index.ts';
import { releaseInquiryFromBacklog } from './backlog.ts';
import type { Decider } from './decider.ts';
import { settleTask, startWork } from './lifecycle.ts';
import { restartInNewRound } from './rounds.ts';
import { stopAllWatchdogs } from './watchdogs.ts';

function quoteOriginal(task: Task) {
  return `${task.handle ? `${task.handle} ` : ''}“${task.title}”`;
}

function closeAsDuplicate(
  decider: Decider,
  task: Task,
  original: Task,
  by: DuplicateActor,
  why: string | null
) {
  decider.emit({ type: 'task.duplicated', taskId: task.id, duplicate: { of: original.id, by, why } });
  settleTask(
    decider,
    task.id,
    'cancelled',
    `duplicate of ${quoteOriginal(original)}`,
    by === 'you' ? 'you' : null
  );
}

function assertCanDuplicate(task: Task, original: Task) {
  if (original.id === task.id) {
    throw new DomainError(
      'duplicate_of_itself',
      'A task cannot be a duplicate of itself. Pick another task.'
    );
  }
  if (isTaskSettled(task)) throw new DomainError('task_settled', 'This task is finished.');
  if (original.duplicate) {
    throw new DomainError(
      'duplicate_of_duplicate',
      `${quoteOriginal(original)} is itself a duplicate. Mark this task a duplicate of the task it duplicates.`
    );
  }
}

export function markDuplicate(decider: Decider, command: CommandOf<'task.mark_duplicate'>) {
  const task = decider.task(command.taskId);
  const original = decider.task(command.duplicateOf);
  assertCanDuplicate(task, original);
  closeAsDuplicate(decider, task, original, 'you', null);
  stopAllWatchdogs(decider, task.id);
}

export function selectTriageDuplicate(decider: Decider, task: Task, duplicateOf: string | undefined) {
  const original = duplicateOf ? decider.state.tasks[duplicateOf] : undefined;
  if (!original || original.id === task.id || isTaskSettled(original) || original.duplicate) return null;
  return original;
}

export function closeTriageDuplicate(decider: Decider, task: Task, original: Task, why: string | null) {
  closeAsDuplicate(decider, task, original, 'shinsa', why);
}

function hasStartedWork(decider: Decider, task: Task) {
  return Object.values(decider.state.runs).some((run) => run.taskId === task.id);
}

export function clearDuplicate(decider: Decider, command: CommandOf<'task.clear_duplicate'>) {
  const task = decider.task(command.taskId);
  if (!task.duplicate) {
    throw new DomainError('not_duplicate', 'This task is not closed as a duplicate.');
  }
  decider.emit({ type: 'task.duplicate_cleared', taskId: task.id });
  if (hasStartedWork(decider, task)) {
    restartInNewRound(decider, task.id);
    return;
  }
  releaseInquiryFromBacklog(decider, task.id);
  startWork(decider, task.id);
}
