import {
  compareTasks,
  isAgentQuestion,
  isDependencyOf,
  isPausingGate,
  isTaskSettled,
  isWatchHome,
  listWaitsOn,
  type ShinsaState,
  selectLeadGate,
  type Task,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import type { Tone } from '@/lib/format/tone.ts';

export type RoadmapGroupKey =
  | 'merge'
  | 'review'
  | 'plan'
  | 'change'
  | 'operation'
  | 'answer'
  | 'paused'
  | 'working'
  | 'waiting'
  | 'done'
  | 'cancelled';

export interface RoadmapGroup {
  key: RoadmapGroupKey;
  title: string;
  icon: IconName;
  tone: Tone;
  defaultOpen: boolean;
}

export interface ChainEntry {
  task: Task;
  depth: number;
}

export const ROADMAP_GROUPS: RoadmapGroup[] = [
  { key: 'merge', title: 'Ready to merge', icon: 'IconMerged', tone: 'green', defaultOpen: true },
  { key: 'review', title: 'Changes to review', icon: 'IconEyeOpen', tone: 'amber', defaultOpen: true },
  { key: 'plan', title: 'Plan to approve', icon: 'IconFileText', tone: 'purple', defaultOpen: true },
  { key: 'change', title: 'Change to approve', icon: 'IconFileEdit', tone: 'purple', defaultOpen: true },
  {
    key: 'operation',
    title: 'Operation to confirm',
    icon: 'IconConsole',
    tone: 'purple',
    defaultOpen: true,
  },
  { key: 'answer', title: 'Needs your answer', icon: 'IconBubbleQuestion', tone: 'blue', defaultOpen: true },
  { key: 'paused', title: 'Paused', icon: 'IconPause', tone: 'orange', defaultOpen: true },
  { key: 'working', title: 'In progress', icon: 'IconRobot', tone: 'blue', defaultOpen: true },
  {
    key: 'waiting',
    title: 'Waiting on another task',
    icon: 'IconHourglass',
    tone: 'neutral',
    defaultOpen: true,
  },
  { key: 'done', title: 'Done', icon: 'IconCheckCircle2', tone: 'purple', defaultOpen: false },
  { key: 'cancelled', title: 'Cancelled', icon: 'IconCircleX', tone: 'neutral', defaultOpen: false },
];

export const ROADMAP_GROUP = Object.fromEntries(ROADMAP_GROUPS.map((group) => [group.key, group])) as Record<
  RoadmapGroupKey,
  RoadmapGroup
>;

export function resolveRoadmapGroup(state: ShinsaState, task: Task): RoadmapGroupKey {
  if (task.stage === 'cancelled') return 'cancelled';
  if (isTaskSettled(task)) return 'done';
  const gate = selectLeadGate(state, task);
  if (gate) {
    if (isPausingGate(gate)) return 'paused';
    if (gate.type === 'proposal') return 'change';
    if (gate.type === 'operation') return 'operation';
    if (isAgentQuestion(gate)) return 'answer';
    if (gate.type === 'merge') return 'merge';
    if (gate.type === 'review') return 'review';
    return 'plan';
  }
  return listWaitsOn(state, task).length > 0 ? 'waiting' : 'working';
}

export function describeWaitsOn(waitsOn: Task[]) {
  const cancelled = waitsOn.find((task) => task.stage === 'cancelled');
  if (cancelled) return `“${cancelled.title}” was cancelled`;
  const titles = waitsOn.map((task) => `“${task.title}”`);
  if (titles.length <= 2) return `Waits on ${titles.join(' and ')}`;
  return `Waits on ${titles.slice(0, 2).join(', ')} and ${titles.length - 2} more`;
}

function createChainLevels(state: ShinsaState, tasks: Task[]) {
  const inGroup = new Map(tasks.map((task) => [task.id, task]));
  const depth = new Map<string, number>();
  const listParents = (task: Task) =>
    listWaitsOn(state, task).flatMap((parent) => inGroup.get(parent.id) ?? []);
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

export function orderChains(state: ShinsaState, tasks: Task[]): ChainEntry[] {
  const { listParents, levelOf } = createChainLevels(state, tasks);
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
      for (const child of (children.get(task.id) ?? []).sort(compareTasks)) visit(child);
    };
    for (const root of roots.sort(compareTasks)) visit(root);
    return ordered;
  };
  const byPriority = tasks.slice().sort(compareTasks);
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

export function selectRoadmapGroup(value: string | null) {
  return ROADMAP_GROUPS.find((group) => group.key === value) ?? null;
}

function orderRoadmapGroup(state: ShinsaState, key: RoadmapGroupKey, tasks: Task[]): ChainEntry[] {
  if (key === 'waiting') return orderChains(state, tasks);
  const sorted =
    key === 'done' || key === 'cancelled'
      ? tasks.slice().sort((a, b) => b.stageChangedAt - a.stageChangedAt)
      : tasks.slice().sort(compareTasks);
  return sorted.map((task) => ({ task, depth: 0 }));
}

function matchesSearch(state: ShinsaState, task: Task, needle: string) {
  const repo = task.repoId ? (state.repos[task.repoId]?.name ?? '') : '';
  return `${task.title} ${task.request} ${task.branch ?? ''} ${repo}`.toLowerCase().includes(needle);
}

export function listRoadmapSections(state: ShinsaState, search: string, status: RoadmapGroupKey | null) {
  const needle = search.trim().toLowerCase();
  const grouped = new Map<RoadmapGroupKey, Task[]>(ROADMAP_GROUPS.map((group) => [group.key, []]));
  for (const task of Object.values(state.tasks)) {
    if (isWatchHome(task)) continue;
    if (!needle || matchesSearch(state, task, needle))
      grouped.get(resolveRoadmapGroup(state, task))?.push(task);
  }
  return ROADMAP_GROUPS.filter((group) => status === null || group.key === status).map((group) => ({
    group,
    entries: orderRoadmapGroup(state, group.key, grouped.get(group.key) ?? []),
  }));
}

export function describeRoadmapCounts(state: ShinsaState) {
  const tasks = Object.values(state.tasks).filter((task) => !isWatchHome(task));
  const open = tasks.filter((task) => !isTaskSettled(task)).length;
  const done = tasks.filter((task) => task.stage === 'merged' || task.stage === 'done').length;
  return `${open} open · ${done} done`;
}
