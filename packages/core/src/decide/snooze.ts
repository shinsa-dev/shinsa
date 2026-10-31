import type { CommandOf } from '../commands/index.ts';
import { DomainError, isTaskSettled } from '../domain/index.ts';
import type { Decider } from './decider.ts';

export function snoozeTask(decider: Decider, command: CommandOf<'task.snooze'>) {
  const task = decider.task(command.taskId);
  if (task.snoozed) return;
  if (isTaskSettled(task))
    throw new DomainError('task_settled', 'This task is finished, so there is nothing to snooze.');
  decider.emit({ type: 'task.snooze_changed', taskId: task.id, snoozed: true });
  decider.requestBriefing(task.id);
}

export function unsnoozeTask(decider: Decider, command: CommandOf<'task.unsnooze'>) {
  const task = decider.task(command.taskId);
  if (!task.snoozed) return;
  decider.emit({ type: 'task.snooze_changed', taskId: task.id, snoozed: false });
  decider.requestBriefing(task.id);
}
