import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  isTaskSettled,
  resolveShareEnd,
  resolveShareLimit,
  resolveSharePreset,
  type ShareEnd,
  type ShareLimit,
  type Task,
} from '../domain/index.ts';
import { listChangedIds } from '../state/draft.ts';
import type { Decider } from './decider.ts';

function assertHumanShares(decider: Decider) {
  if (!decider.context.onBehalf) return;
  throw new DomainError(
    'human_only',
    'Only the human decides what is shared outside this machine. Tell them they can share it from the task in Shinsa.'
  );
}

function assertShareLimit(task: Task, limit: ShareLimit) {
  if (limit !== 'until_done' || !isTaskSettled(task)) return;
  throw new DomainError(
    'share_refused',
    'This task is finished, so sharing it until it finishes would end at once. Pick a time limit instead.'
  );
}

function endShare(decider: Decider, task: Task, reason: ShareEnd) {
  decider.cancelEffects(task.id, ['share.link'], 'The task is no longer shared.');
  decider.emit({ type: 'task.unshared', taskId: task.id, reason });
}

function isShareExpired(decider: Decider, task: Task) {
  const endsAt = task.share?.endsAt ?? null;
  return endsAt !== null && endsAt <= decider.context.now;
}

export function shareTask(decider: Decider, command: CommandOf<'task.share'>) {
  assertHumanShares(decider);
  const shared = decider.task(command.taskId);
  if (isShareExpired(decider, shared)) endShare(decider, shared, 'expired');
  const task = decider.task(command.taskId);
  if (task.watchHome) throw new DomainError('share_refused', 'An automation has nothing to share.');
  const limit = command.limit ?? task.share?.limit ?? resolveShareLimit(decider.state.settings);
  const preset = command.preset ?? task.share?.preset ?? resolveSharePreset(decider.state.settings);
  assertShareLimit(task, limit);
  if (task.share && task.share.limit === limit && task.share.preset === preset) {
    if (task.share.failure) decider.run({ kind: 'share.link', taskId: task.id });
    return;
  }
  const endsAt =
    task.share?.limit === limit ? task.share.endsAt : resolveShareEnd(limit, decider.context.now);
  decider.emit({ type: 'task.shared', taskId: task.id, limit, preset, endsAt });
  if (!task.share || task.share.failure) decider.run({ kind: 'share.link', taskId: task.id });
}

export function unshareTask(decider: Decider, command: CommandOf<'task.unshare'>) {
  assertHumanShares(decider);
  const task = decider.task(command.taskId);
  if (!task.share) return;
  endShare(decider, task, 'you');
}

export function expireShare(decider: Decider, command: CommandOf<'share.expire'>) {
  const task = decider.state.tasks[command.taskId];
  if (!task || !isShareExpired(decider, task)) return;
  endShare(decider, task, 'expired');
}

export function syncShares(decider: Decider) {
  for (const id of listChangedIds(decider.state, 'tasks')) {
    const task = decider.state.tasks[id];
    if (task?.share?.limit === 'until_done' && isTaskSettled(task)) endShare(decider, task, 'done');
  }
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
