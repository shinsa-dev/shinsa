import type { CommandOf } from '../commands/index.ts';
import { DomainError, type Gate, isTaskSettled } from '../domain/index.ts';
import { listBundleFollowers, listOpenGates } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { approveMergeAhead } from './gates.ts';
import { hasOpenPreMergeSteps } from './merge-steps.ts';

export function mergeOnceReady(decider: Decider, gate: Gate) {
  const task = decider.task(gate.taskId);
  if (gate.type !== 'merge' || !task.mergeAhead || hasOpenPreMergeSteps(decider, task)) return false;
  approveMergeAhead(decider, gate);
  return true;
}

export function mergeOnceTicked(decider: Decider, taskId: string) {
  const gate = listOpenGates(decider.state).find((open) => {
    if (open.type !== 'merge') return false;
    const lead = decider.task(open.taskId);
    return (
      lead.id === taskId || listBundleFollowers(decider.state, lead).some((member) => member.id === taskId)
    );
  });
  if (gate) mergeOnceReady(decider, gate);
}

export function keepMergeGate(decider: Decider, command: CommandOf<'task.keep_merge_gate'>) {
  if (decider.context.onBehalf) {
    throw new DomainError({
      code: 'human_only',
      message: 'Only the human decides how a pull request merges. Tell them it is waiting in Shinsa.',
    });
  }
  const task = decider.task(command.taskId);
  if (isTaskSettled(task)) throw new DomainError({ code: 'task_settled', message: 'This task is finished.' });
  if (!task.mergeAhead) {
    throw new DomainError({
      code: 'merge_gate_kept',
      message: 'This task already waits for you to merge it.',
    });
  }
  decider.emit({ type: 'task.merge_gate_kept', taskId: task.id });
}
