import type { CommandOf } from '../commands/index.ts';
import { DomainError } from '../domain/index.ts';
import type { Decider } from './decider.ts';

function assertHumanShares(decider: Decider) {
  if (!decider.context.onBehalf) return;
  throw new DomainError(
    'human_only',
    'Only the human decides what is shared outside this machine. Tell them they can share it from the task in Shinsa.'
  );
}

export function shareTask(decider: Decider, command: CommandOf<'task.share'>) {
  assertHumanShares(decider);
  const task = decider.task(command.taskId);
  if (task.watchHome) throw new DomainError('share_refused', 'An automation has nothing to share.');
  if (task.share) {
    if (task.share.failure) decider.run({ kind: 'share.link', taskId: task.id });
    return;
  }
  decider.emit({ type: 'task.shared', taskId: task.id });
  decider.run({ kind: 'share.link', taskId: task.id });
}

export function unshareTask(decider: Decider, command: CommandOf<'task.unshare'>) {
  assertHumanShares(decider);
  const task = decider.task(command.taskId);
  if (!task.share) return;
  decider.cancelEffects(task.id, ['share.link'], 'The task is no longer shared.');
  decider.emit({ type: 'task.unshared', taskId: task.id });
}

export function recordShare(decider: Decider, command: CommandOf<'share.record'>) {
  const share = decider.state.tasks[command.taskId]?.share;
  if (!share) return;
  const url = command.url ?? share.url;
  if (url === share.url && !share.failure) return;
  decider.emit({ type: 'share.recorded', taskId: command.taskId, url });
}

export function failShare(decider: Decider, command: CommandOf<'share.fail'>) {
  const share = decider.state.tasks[command.taskId]?.share;
  if (!share || share.failure === command.detail) return;
  decider.emit({ type: 'share.failed', taskId: command.taskId, detail: command.detail });
}
