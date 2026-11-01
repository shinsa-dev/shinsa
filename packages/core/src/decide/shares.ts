import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  isTaskSettled,
  type PreviewShare,
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
  decider.cancelEffects(task.id, ['share.link', 'share.describe'], 'The task is no longer shared.');
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
  if (!task.share) decider.run({ kind: 'share.describe', taskId: task.id });
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
    if (!task || !isTaskSettled(task)) continue;
    if (task.share?.limit === 'until_done') endShare(decider, task, 'done');
    for (const preview of task.previews ?? []) endPreview(decider, task.id, preview.serviceId, 'done');
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

export function describeShare(decider: Decider, command: CommandOf<'share.describe'>) {
  const share = decider.state.tasks[command.taskId]?.share;
  const description = command.description.trim();
  if (!share || !description || share.description === description) return;
  decider.emit({ type: 'share.described', taskId: command.taskId, description });
}

function selectPreview(task: Task | undefined, serviceId: string) {
  return task?.previews?.find((preview) => preview.serviceId === serviceId) ?? null;
}

function isPreviewExpired(decider: Decider, preview: PreviewShare | null) {
  const endsAt = preview?.endsAt ?? null;
  return endsAt !== null && endsAt <= decider.context.now;
}

function endPreview(decider: Decider, taskId: string, serviceId: string, reason: ShareEnd) {
  decider.cancelEffects(taskId, ['preview.link'], 'The preview is no longer shared.');
  decider.emit({ type: 'preview.unshared', taskId, serviceId, reason });
  if (reason === 'done') return;
  for (const preview of decider.task(taskId).previews ?? []) {
    if (!preview.url && !preview.failure)
      decider.run({ kind: 'preview.link', taskId, serviceId: preview.serviceId });
  }
}

function assertServicesRun(task: Task) {
  if (task.watchHome) throw new DomainError('share_refused', 'An automation has no services to share.');
  if (!isTaskSettled(task)) return;
  throw new DomainError(
    'share_refused',
    'This task is finished, so its services no longer run here. Start the service from an open task to share it.'
  );
}

export function sharePreview(decider: Decider, command: CommandOf<'preview.share'>) {
  assertHumanShares(decider);
  const current = selectPreview(decider.task(command.taskId), command.serviceId);
  if (isPreviewExpired(decider, current)) endPreview(decider, command.taskId, command.serviceId, 'expired');
  const task = decider.task(command.taskId);
  assertServicesRun(task);
  const preview = selectPreview(task, command.serviceId);
  const limit = command.limit ?? preview?.limit ?? resolveShareLimit(decider.state.settings);
  const link = { kind: 'preview.link', taskId: task.id, serviceId: command.serviceId } as const;
  if (preview && preview.limit === limit) {
    if (preview.failure) decider.run(link);
    return;
  }
  const endsAt = resolveShareEnd(limit, decider.context.now);
  decider.emit({ type: 'preview.shared', taskId: task.id, serviceId: command.serviceId, limit, endsAt });
  if (!preview || preview.failure) decider.run(link);
}

export function unsharePreview(decider: Decider, command: CommandOf<'preview.unshare'>) {
  assertHumanShares(decider);
  if (!selectPreview(decider.task(command.taskId), command.serviceId)) return;
  endPreview(decider, command.taskId, command.serviceId, 'you');
}

export function expirePreview(decider: Decider, command: CommandOf<'preview.expire'>) {
  const preview = selectPreview(decider.state.tasks[command.taskId], command.serviceId);
  if (!isPreviewExpired(decider, preview)) return;
  endPreview(decider, command.taskId, command.serviceId, 'expired');
}

export function recordPreview(decider: Decider, command: CommandOf<'preview.record'>) {
  const preview = selectPreview(decider.state.tasks[command.taskId], command.serviceId);
  if (!preview) return;
  const url = command.url ?? preview.url;
  if (url === preview.url && !preview.failure) return;
  decider.emit({ type: 'preview.recorded', taskId: command.taskId, serviceId: command.serviceId, url });
}

export function failPreview(decider: Decider, command: CommandOf<'preview.fail'>) {
  const preview = selectPreview(decider.state.tasks[command.taskId], command.serviceId);
  if (!preview || preview.failure === command.detail) return;
  decider.emit({
    type: 'preview.failed',
    taskId: command.taskId,
    serviceId: command.serviceId,
    detail: command.detail,
  });
}
