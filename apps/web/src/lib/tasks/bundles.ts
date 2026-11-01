import {
  canChangeStack,
  compareTasks,
  isTaskComplete,
  isTaskSettled,
  isWatchHome,
  listOpenGates,
  resolveBundle,
  type ShinsaState,
  selectStackedOnThis,
  selectStackRefusal,
  type Task,
  type TaskStage,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import type { Tone } from '@/lib/format/tone.ts';

export const BUNDLE_ICON: IconName = 'IconLayersThree';

export const STACK_LABEL = 'Stack on another task';

export type BundleMemberState = 'waiting' | 'working' | 'ready' | 'merging' | 'merged' | 'cancelled';

export const BUNDLE_MEMBER: Record<BundleMemberState, { label: string; tone: Tone }> = {
  waiting: { label: 'Waiting', tone: 'neutral' },
  working: { label: 'Working', tone: 'blue' },
  ready: { label: 'Ready', tone: 'green' },
  merging: { label: 'Merging', tone: 'green' },
  merged: { label: 'Merged', tone: 'purple' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const BUNDLE_READY_STATUS = { label: 'Ready, merges with its bundle', tone: 'green' } as const;

export const BUNDLE_MERGING_STATUS = { label: 'Merging with its bundle', tone: 'green' } as const;

const NOT_STARTED: ReadonlySet<TaskStage> = new Set<TaskStage>(['triage', 'waiting_on_tasks']);

export interface BundleRow {
  task: Task;
  state: BundleMemberState;
  current: boolean;
}

function hasMergeGate(state: ShinsaState, task: Task) {
  return listOpenGates(state, task.id).some((gate) => gate.type === 'merge');
}

export function isMergingWithBundle(state: ShinsaState, task: Task) {
  return (
    task.stage === 'awaiting_merge' &&
    Boolean(task.stacksOn || selectStackedOnThis(state, task.id)) &&
    listOpenGates(state, task.id).length === 0
  );
}

export function resolveBundleMemberState(state: ShinsaState, task: Task): BundleMemberState {
  if (task.stage === 'cancelled') return 'cancelled';
  if (isTaskComplete(task)) return 'merged';
  if (task.bundleReady || hasMergeGate(state, task)) return 'ready';
  if (isMergingWithBundle(state, task)) return 'merging';
  if (NOT_STARTED.has(task.stage)) return 'waiting';
  return 'working';
}

export function listBundleRows(state: ShinsaState, task: Task): BundleRow[] {
  return resolveBundle(state, task).map((member) => ({
    task: member,
    state: resolveBundleMemberState(state, member),
    current: member.id === task.id,
  }));
}

function countReady(rows: BundleRow[]) {
  return rows.filter((row) => row.state === 'ready' || row.state === 'merged').length;
}

export function describeBundleProgress(rows: BundleRow[]) {
  return `${countReady(rows)} of ${rows.length} ready`;
}

export function describeBundleCount(rows: BundleRow[]) {
  return `${countReady(rows)}/${rows.length}`;
}

export function selectBundleTop(state: ShinsaState, task: Task) {
  const open = resolveBundle(state, task).filter((member) => !isTaskSettled(member));
  return open.at(-1) ?? null;
}

export function listStackChoices(state: ShinsaState, task: Task | null) {
  if (task && !canChangeStack(task)) return [];
  return Object.values(state.tasks)
    .filter((candidate) => candidate.id !== task?.id && !isWatchHome(candidate))
    .filter((candidate) => selectStackRefusal(state, task, candidate) === null)
    .sort((a, b) => Number(a.id !== task?.stacksOn) - Number(b.id !== task?.stacksOn) || compareTasks(a, b));
}

export function stackOnTask(task: Task, parent: Task) {
  return sendCommandWithToast(
    { type: 'task.stack_on', taskId: task.id, stacksOn: parent.id },
    `Stacked on “${parent.title}”.`
  );
}

export function unstackTask(task: Task) {
  return sendCommandWithToast(
    { type: 'task.stack_on', taskId: task.id, stacksOn: null },
    'Taken out of the bundle.'
  );
}

export function toggleStack(task: Task, parent: Task) {
  return task.stacksOn === parent.id ? unstackTask(task) : stackOnTask(task, parent);
}

export function resolveBundleBranch(state: ShinsaState, rows: BundleRow[]) {
  const first = rows[0]?.task;
  return (first?.repoId ? state.repos[first.repoId]?.defaultBranch : null) ?? 'the default branch';
}

export function describeBundleNote(state: ShinsaState, rows: BundleRow[]) {
  const branch = resolveBundleBranch(state, rows);
  if (rows.every((row) => row.state === 'merged' || row.state === 'cancelled')) {
    return `The bundle merged into ${branch}.`;
  }
  const top = rows.filter((row) => row.state !== 'merged' && row.state !== 'cancelled').at(-1)?.task;
  return `Number 1 targets ${branch} and each one after it builds on the one before. Once every task is ready, approving “${top?.title}” merges them all into ${branch}, from the last back to number 1.`;
}

export function describeBundleWait(state: ShinsaState, task: Task) {
  if (isMergingWithBundle(state, task)) return 'Merging with its bundle';
  if (!task.bundleReady) return null;
  const top = selectBundleTop(state, task);
  if (!top || top.id === task.id) return null;
  if (hasMergeGate(state, top)) return `Merges when you approve the bundle on “${top.title}”`;
  return `Merges with its bundle once “${top.title}” is ready`;
}
