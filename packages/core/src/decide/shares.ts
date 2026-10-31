import type { CommandOf } from '../commands/index.ts';
import { DomainError } from '../domain/index.ts';
import { resolveSharedFingerprint } from '../share/index.ts';
import { listChangedIds } from '../state/draft.ts';
import type { ShinsaState } from '../state/project.ts';
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
    if (task.share.failure) decider.run({ kind: 'share.publish', taskId: task.id });
    return;
  }
  decider.emit({ type: 'task.shared', taskId: task.id });
  decider.run({ kind: 'share.publish', taskId: task.id });
}

export function unshareTask(decider: Decider, command: CommandOf<'task.unshare'>) {
  assertHumanShares(decider);
  const task = decider.task(command.taskId);
  if (!task.share) return;
  decider.cancelEffects(task.id, ['share.publish'], 'The task is no longer shared.');
  decider.emit({ type: 'task.unshared', taskId: task.id });
  decider.run({ kind: 'share.remove', taskId: task.id });
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

function listTouchedTaskIds(decider: Decider) {
  const touched = new Set(listChangedIds(decider.state, 'tasks'));
  for (const id of listChangedIds(decider.state, 'evidence')) {
    const evidence = decider.state.evidence[id];
    if (evidence) touched.add(evidence.taskId);
  }
  if (listChangedIds(decider.state, 'projects').length > 0) {
    for (const task of Object.values(decider.state.tasks)) if (task.share) touched.add(task.id);
  }
  return touched;
}

function isPublishing(decider: Decider, taskId: string) {
  return decider.effects.some(
    (effect) =>
      (effect.kind === 'share.publish' || effect.kind === 'share.remove') && effect.taskId === taskId
  );
}

export function syncShares(decider: Decider, before: ShinsaState) {
  for (const taskId of listTouchedTaskIds(decider)) {
    if (!decider.state.tasks[taskId]?.share || isPublishing(decider, taskId)) continue;
    const after = resolveSharedFingerprint(decider.state, taskId);
    if (after === resolveSharedFingerprint(before, taskId)) continue;
    decider.run({ kind: 'share.publish', taskId });
  }
}
