import {
  compareTasks,
  type Gate,
  type GateType,
  isAgentQuestion,
  isDecisionHeld,
  isDependencyOf,
  isHeldInBacklog,
  isPausingGate,
  isTaskSettled,
  isWatchHome,
  listBundleBlockers,
  listWaitsOn,
  type ShinsaState,
  selectLeadGate,
  listStackParents,
  type Task,
  type TeamFeedTask,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { Option } from 'effect';
import { GATE } from '@/lib/format/labels.ts';
import type { Tone } from '@/lib/format/tone.ts';
import { isMergingWithBundle, selectBundleRoot } from '@/lib/tasks/bundles.ts';

export type TaskGroupKey =
  | 'merge'
  | 'review'
  | 'plan'
  | 'change'
  | 'operation'
  | 'answer'
  | 'answered'
  | 'paused'
  | 'working'
  | 'snoozed'
  | 'backlog'
  | 'done'
  | 'duplicate'
  | 'cancelled';

export interface TaskGroup {
  key: TaskGroupKey;
  title: string;
  icon: IconName;
  tone: Tone;
  defaultOpen: boolean;
}

export interface TeamEntry {
  entry: TeamFeedTask;
  state: ShinsaState;
  heldAt: number | null;
}

export interface TaskGroupRow {
  task: Task;
  group: TaskGroupKey;
  team?: TeamEntry;
}

export interface ChainEntry {
  task: Task;
  depth: number;
  team?: TeamEntry;
}

function createGateGroup(key: TaskGroupKey, type: GateType): TaskGroup {
  const { label, icon, tone } = GATE[type];
  return { key, title: label, icon, tone, defaultOpen: true };
}

export const TASK_GROUPS: TaskGroup[] = [
  createGateGroup('merge', 'merge'),
  createGateGroup('review', 'review'),
  createGateGroup('plan', 'plan'),
  createGateGroup('change', 'proposal'),
  createGateGroup('operation', 'operation'),
  createGateGroup('answer', 'question'),
  createGateGroup('answered', 'result'),
  createGateGroup('paused', 'failure'),
  { key: 'working', title: 'In progress', icon: 'IconRobot', tone: 'blue', defaultOpen: true },
  { key: 'snoozed', title: 'Snoozed', icon: 'IconClockSnooze', tone: 'neutral', defaultOpen: false },
  { key: 'backlog', title: 'Backlog', icon: 'IconArchive', tone: 'neutral', defaultOpen: true },
  { key: 'done', title: 'Done', icon: 'IconCheckCircle2', tone: 'purple', defaultOpen: false },
  {
    key: 'duplicate',
    title: 'Duplicates',
    icon: 'IconSquareBehindSquare2',
    tone: 'neutral',
    defaultOpen: false,
  },
  { key: 'cancelled', title: 'Cancelled', icon: 'IconCircleX', tone: 'neutral', defaultOpen: false },
];

export const TASK_GROUP = Object.fromEntries(TASK_GROUPS.map((group) => [group.key, group])) as Record<
  TaskGroupKey,
  TaskGroup
>;

function resolveGateGroup(gate: Gate): TaskGroupKey {
  if (isPausingGate(gate)) return 'paused';
  if (gate.type === 'proposal') return 'change';
  if (gate.type === 'operation') return 'operation';
  if (isAgentQuestion(gate)) return 'answer';
  if (gate.type === 'result') return 'answered';
  if (gate.type === 'merge') return 'merge';
  if (gate.type === 'review') return 'review';
  return 'plan';
}

function isWaitingForBundle(state: ShinsaState, task: Task) {
  return Boolean(task.bundleReady) || isMergingWithBundle(state, task);
}

export function isHeldByTasks(state: ShinsaState, task: Task) {
  return !task.snoozed && listWaitsOn(state, task).length > 0;
}

function selectGroupAnchor(state: ShinsaState, task: Task, seen: ReadonlySet<string>) {
  return (
    listWaitsOn(state, task)
      .filter((parent) => !seen.has(parent.id) && !isTaskSettled(parent))
      .sort(compareTasks)[0] ?? null
  );
}

function resolveGroupWithin(state: ShinsaState, task: Task, seen: ReadonlySet<string>): TaskGroupKey {
  if (task.duplicate) return 'duplicate';
  if (task.stage === 'cancelled') return 'cancelled';
  if (isTaskSettled(task)) return 'done';
  if (task.snoozed) return 'snoozed';
  const gate = Option.getOrNull(selectLeadGate(state, task));
  if (gate && isHeldInBacklog(state, gate)) return 'backlog';
  if (gate) return resolveGateGroup(gate);
  const next = new Set(seen).add(task.id);
  const root = isWaitingForBundle(state, task) ? selectBundleRoot(state, task) : null;
  if (root && !next.has(root.id)) return resolveGroupWithin(state, root, next);
  const anchor = selectGroupAnchor(state, task, next);
  if (anchor) return resolveGroupWithin(state, anchor, next);
  return task.backlog ? 'backlog' : 'working';
}

export function resolveTaskGroup(state: ShinsaState, task: Task): TaskGroupKey {
  return resolveGroupWithin(state, task, new Set());
}

export function describeWaitsOn(waitsOn: Task[]) {
  const cancelled = waitsOn.find((task) => task.stage === 'cancelled');
  if (cancelled) return `“${cancelled.title}” was cancelled`;
  const titles = waitsOn.map((task) => `“${task.title}”`);
  if (titles.length <= 2) return `Waits on ${titles.join(' and ')}`;
  return `Waits on ${titles.slice(0, 2).join(', ')} and ${titles.length - 2} more`;
}

export function describeHeldWait(state: ShinsaState, task: Task) {
  return isDecisionHeld(state, task) ? describeWaitsOn(listWaitsOn(state, task)) : null;
}

export function describeBundleWait(state: ShinsaState, task: Task) {
  const blockers = listBundleBlockers(state, task);
  return blockers.length > 0 ? describeWaitsOn(blockers) : null;
}

function listChainParents(state: ShinsaState, task: Task) {
  const parents = listWaitsOn(state, task);
  const below = listStackParents(state, task).filter(
    (parent) => !isTaskSettled(parent) && !parents.includes(parent)
  );
  return [...parents, ...below];
}

export interface ChainOrder {
  parents: (task: Task) => Task[];
  compare: (a: Task, b: Task) => number;
}

function createChainLevels(tasks: Task[], order: ChainOrder) {
  const inGroup = new Map(tasks.map((task) => [task.id, task]));
  const depth = new Map<string, number>();
  const listParents = (task: Task) => order.parents(task).flatMap((parent) => inGroup.get(parent.id) ?? []);
  const resolveDepth = (task: Task, path: ReadonlySet<string>): number => {
    const known = depth.get(task.id);
    if (known !== undefined) return known;
    const parents = listParents(task).filter((parent) => !path.has(parent.id));
    const next = new Set(path).add(task.id);
    const value =
      parents.length === 0 ? 0 : 1 + Math.max(...parents.map((parent) => resolveDepth(parent, next)));
    depth.set(task.id, value);
    return value;
  };
  return { listParents, levelOf: (task: Task) => resolveDepth(task, new Set()) };
}

export function orderChains(
  state: ShinsaState,
  tasks: Task[],
  order: ChainOrder = { parents: (task) => listChainParents(state, task), compare: compareTasks }
): ChainEntry[] {
  const { listParents, levelOf } = createChainLevels(tasks, order);
  const arrange = (rank: (task: Task) => number) => {
    const children = new Map<string, Task[]>();
    const roots: Task[] = [];
    for (const task of tasks) {
      const level = levelOf(task);
      const anchor = listParents(task)
        .filter((parent) => levelOf(parent) === level - 1)
        .sort((a, b) => rank(a) - rank(b))
        .at(-1);
      if (anchor) children.set(anchor.id, [...(children.get(anchor.id) ?? []), task]);
      else roots.push(task);
    }
    const ordered: ChainEntry[] = [];
    const seen = new Set<string>();
    const visit = (task: Task) => {
      if (seen.has(task.id)) return;
      seen.add(task.id);
      ordered.push({ task, depth: levelOf(task) });
      for (const child of (children.get(task.id) ?? []).sort(order.compare)) visit(child);
    };
    for (const root of roots.sort(order.compare)) visit(root);
    return ordered;
  };
  const byPriority = tasks.slice().sort(order.compare);
  const first = arrange((task) => byPriority.indexOf(task));
  const shown = first.map((entry) => entry.task.id);
  return arrange((task) => shown.indexOf(task.id));
}

export function listOpenTaskChoices(state: ShinsaState, task: Task | null) {
  return Object.values(state.tasks)
    .filter((candidate) => !isTaskSettled(candidate) && !isWatchHome(candidate))
    .filter((candidate) => !task || !isDependencyOf(state, task.id, candidate.id))
    .sort(compareTasks);
}

export function selectTaskGroup(value: string | null) {
  return TASK_GROUPS.find((group) => group.key === value) ?? null;
}

function isSettledGroup(key: TaskGroupKey) {
  return key === 'done' || key === 'duplicate' || key === 'cancelled';
}

function orderTaskGroup(state: ShinsaState, key: TaskGroupKey, tasks: Task[]): ChainEntry[] {
  if (isSettledGroup(key)) {
    return tasks
      .slice()
      .sort((a, b) => b.stageChangedAt - a.stageChangedAt)
      .map((task) => ({ task, depth: 0 }));
  }
  return orderChains(state, tasks);
}

function compareInGroup(key: TaskGroupKey, left: Task, right: Task) {
  return isSettledGroup(key) ? right.stageChangedAt - left.stageChangedAt : compareTasks(left, right);
}

function mergeTeamEntries(key: TaskGroupKey, own: ChainEntry[], team: TeamEntry[]): ChainEntry[] {
  const waiting = team
    .map((entry): ChainEntry => ({ task: entry.entry.task, depth: 0, team: entry }))
    .sort((left, right) => compareInGroup(key, left.task, right.task));
  const merged: ChainEntry[] = [];
  for (const entry of own) {
    while (entry.depth === 0 && waiting[0] && compareInGroup(key, waiting[0].task, entry.task) < 0) {
      merged.push(waiting.shift() as ChainEntry);
    }
    merged.push(entry);
  }
  return [...merged, ...waiting];
}

export function listTaskGroupSections(
  state: ShinsaState,
  rows: readonly TaskGroupRow[],
  statuses: readonly string[] = []
) {
  const grouped = new Map<TaskGroupKey, Task[]>(TASK_GROUPS.map((group) => [group.key, []]));
  const teamGrouped = new Map<TaskGroupKey, TeamEntry[]>(TASK_GROUPS.map((group) => [group.key, []]));
  for (const row of rows) {
    if (row.team) teamGrouped.get(row.group)?.push(row.team);
    else grouped.get(row.group)?.push(row.task);
  }
  return TASK_GROUPS.filter((group) => statuses.length === 0 || statuses.includes(group.key)).map(
    (group) => ({
      group,
      entries: mergeTeamEntries(
        group.key,
        orderTaskGroup(state, group.key, grouped.get(group.key) ?? []),
        teamGrouped.get(group.key) ?? []
      ),
    })
  );
}

export function describeTaskCounts(tasks: readonly Task[]) {
  const open = tasks.filter((task) => !isTaskSettled(task)).length;
  const done = tasks.filter((task) => task.stage === 'merged' || task.stage === 'done').length;
  return `${open} open · ${done} done`;
}
