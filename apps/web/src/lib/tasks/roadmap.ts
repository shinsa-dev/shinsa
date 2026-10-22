import {
  compareTasks,
  isDependencyOf,
  isTaskSettled,
  listWaitsOn,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import type { Tone } from '@/lib/format/tone.ts';
import { selectLeadGate } from './task-status.ts';

export type RoadmapGroupKey =
  | 'merge'
  | 'review'
  | 'plan'
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
  const gate = selectLeadGate(state, task.id);
  if (gate) {
    if (gate.purpose === 'failure') return 'paused';
    if (gate.purpose === 'agent_question' || gate.kind === 'question') return 'answer';
    if (gate.kind === 'merge') return 'merge';
    if (gate.kind === 'review') return 'review';
    return 'plan';
  }
  return listWaitsOn(state, task).length > 0 ? 'waiting' : 'working';
}

export function describeWaitsOn(waitsOn: Task[]) {
  const cancelled = waitsOn.find((task) => task.stage === 'cancelled');
  if (cancelled) return `${cancelled.title} was cancelled`;
  const titles = waitsOn.map((task) => task.title);
  if (titles.length === 0) return 'Waiting on another task';
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
    .filter((candidate) => !isTaskSettled(candidate))
    .filter((candidate) => !task || !isDependencyOf(state, task.id, candidate.id))
    .sort(compareTasks);
}
