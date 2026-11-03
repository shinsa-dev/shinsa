import {
  canChangeStack,
  compareTasks,
  describeList,
  isTaskComplete,
  isTaskSettled,
  isWatchHome,
  listOpenGates,
  listStackChildren,
  listStackParents,
  resolveBundle,
  resolveBundleMembers,
  type ShinsaState,
  selectStackRefusal,
  type Task,
  type TaskStage,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { connection, selectEngineCommands } from '@/lib/connection/socket.ts';
import type { Tone } from '@/lib/format/tone.ts';
import { orderChains } from '@/lib/tasks/groups.ts';

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
  depth: number;
  parents: Task[];
}

function hasMergeGate(state: ShinsaState, task: Task) {
  return listOpenGates(state, task.id).some((gate) => gate.type === 'merge');
}

export function isMergingWithBundle(state: ShinsaState, task: Task) {
  return (
    task.stage === 'awaiting_merge' &&
    ((task.stacksOn?.length ?? 0) > 0 || listStackChildren(state, task.id).length > 0) &&
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
  const members = resolveBundle(state, task);
  const position = new Map(members.map((member, index) => [member.id, index]));
  const listParents = (member: Task) =>
    listStackParents(state, member).filter((parent) => position.has(parent.id));
  const tree = orderChains(state, members, {
    parents: listParents,
    compare: (a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0),
  });
  return tree.map(({ task: member, depth }) => {
    const parents = listParents(member);
    return {
      task: member,
      state: resolveBundleMemberState(state, member),
      current: member.id === task.id,
      depth,
      parents: parents.length > 1 ? parents : [],
    };
  });
}

function describeBuildsOn(names: string[]) {
  return `Builds on ${describeList(names)}`;
}

export function describeBundleParents(parents: Task[]) {
  return describeBuildsOn(parents.map((parent) => `“${parent.title}”`));
}

export function describeBundleParentHandles(parents: Task[]) {
  return describeBuildsOn(parents.map((parent) => parent.handle ?? `“${parent.title}”`));
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

export function selectBundleRoot(state: ShinsaState, task: Task) {
  const [lead, ...followers] = resolveBundleMembers(state, task);
  return lead && followers.length > 0 && !isTaskSettled(lead) ? lead : null;
}

function isStackSpoken(task: Task) {
  return selectEngineCommands(connection.selectEngine(task.id)).has('task.stack_on_tasks');
}

function isStackedOn(task: Task | null, parent: Task) {
  return task?.stacksOn?.includes(parent.id) ?? false;
}

export function listStackChoices(state: ShinsaState, task: Task | null, repoId = task?.repoId ?? null) {
  if (task && !canChangeStack(task)) return [];
  return Object.values(state.tasks)
    .filter((candidate) => candidate.id !== task?.id && !isWatchHome(candidate))
    .filter((candidate) => selectStackRefusal(state, task, candidate, repoId) === null)
    .filter((candidate) => isStackSpoken(candidate))
    .sort((a, b) => Number(!isStackedOn(task, a)) - Number(!isStackedOn(task, b)) || compareTasks(a, b));
}

export function stackOnTask(task: Task, parent: Task) {
  return sendCommandWithToast(
    { type: 'task.stack_on_tasks', taskId: task.id, stacksOn: [...(task.stacksOn ?? []), parent.id] },
    `Stacked on “${parent.title}”.`
  );
}

function unstackFrom(task: Task, parent: Task) {
  const stacksOn = (task.stacksOn ?? []).filter((id) => id !== parent.id);
  if (stacksOn.length === 0) return unstackTask(task);
  return sendCommandWithToast(
    { type: 'task.stack_on_tasks', taskId: task.id, stacksOn },
    `No longer stacked on “${parent.title}”.`
  );
}

export function unstackTask(task: Task) {
  return sendCommandWithToast(
    { type: 'task.stack_on_tasks', taskId: task.id, stacksOn: [] },
    'Taken out of the bundle.'
  );
}

export function toggleStack(task: Task, parent: Task) {
  return isStackedOn(task, parent) ? unstackFrom(task, parent) : stackOnTask(task, parent);
}

function resolveBundleBranch(state: ShinsaState, rows: Pick<BundleRow, 'task'>[]) {
  const first = rows[0]?.task;
  return (first?.repoId ? state.repos[first.repoId]?.defaultBranch : null) ?? 'the default branch';
}

export function describeBundleNote(state: ShinsaState, rows: BundleRow[]) {
  const branch = resolveBundleBranch(state, rows);
  if (rows.every((row) => row.state === 'merged' || row.state === 'cancelled')) {
    return `The bundle merged into ${branch}.`;
  }
  const root = rows.find((row) => row.state !== 'merged' && row.state !== 'cancelled')?.task;
  return `Each task builds on the tasks above it, and the ones that build on nothing target ${branch}. Once every task is ready and the whole bundle merges into ${branch} without conflicts, approving “${root?.title}” merges them all, from the bottom up.`;
}

export function describeBundleWait(state: ShinsaState, task: Task) {
  if (isMergingWithBundle(state, task)) return 'Merging with its bundle';
  if (!task.bundleReady) return null;
  const root = selectBundleRoot(state, task);
  if (!root || root.id === task.id) return null;
  if (hasMergeGate(state, root)) return `Merges when you approve the bundle on “${root.title}”`;
  return `Merges with its bundle once “${root.title}” is ready`;
}
