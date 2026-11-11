import {
  describePhaseProgress,
  type Gate,
  type Initiative,
  isLeadTask,
  listInitiativeProgress,
  type Queue,
  type QueuedGate,
  resolveBundle,
  resolveInitiativeTotals,
  type ShinsaState,
  selectInitiativeLead,
  type Task,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import type { Tone } from '@/lib/format/tone.ts';
import { createDisclosureId, type DisclosureScope } from '@/lib/preferences/disclosure.ts';
import { describeBundleProgress, listBundleRows } from '@/lib/tasks/bundles.ts';
import { orderChains, TASK_GROUP } from '@/lib/tasks/groups.ts';
import type { Route } from '@/router.ts';

export type QueueItem =
  | { kind: 'gate'; key: string; task: Task; gate: Gate; since: number; sinceLabel: string }
  | { kind: 'working' | 'idle'; key: string; task: Task; since: number; sinceLabel: string };

export interface QueueGroup {
  kind: 'initiative' | 'bundle';
  id: string;
  key: string;
  title: string;
  progress: string;
  opens: Task | null;
  root: QueueItem | null;
  members: QueueItem[];
}

export type QueueEntry = { kind: 'item'; item: QueueItem } | { kind: 'group'; group: QueueGroup };

export interface QueueSection {
  key: 'needs' | 'working' | 'waiting' | 'snoozed';
  title: string;
  icon: IconName;
  tone: Tone;
  items: QueueItem[];
  entries: QueueEntry[];
  empty: string | null;
  startsCollapsed: boolean;
  opensOnHome: boolean;
}

function listGateItems(entries: QueuedGate[]): QueueItem[] {
  return entries.map((entry) => ({
    kind: 'gate',
    key: entry.gate.id,
    task: entry.task,
    gate: entry.gate,
    since: entry.gate.openedAt,
    sinceLabel: 'Waiting on you',
  }));
}

const WAITING_GROUP = { title: 'Waiting on another task', icon: 'IconHourglass', tone: 'neutral' } as const;

function selectGroupInitiative(state: ShinsaState, task: Task) {
  return task.initiativeId ? (state.initiatives[task.initiativeId] ?? null) : null;
}

function resolveGroupKey(state: ShinsaState, task: Task) {
  const initiative = selectGroupInitiative(state, task);
  if (initiative) return `initiative:${initiative.id}`;
  const [first] = resolveBundle(state, task);
  return first ? `bundle:${first.id}` : null;
}

function describeInitiativeGroupProgress(state: ShinsaState, initiative: Initiative) {
  const totals = resolveInitiativeTotals(listInitiativeProgress(state, initiative));
  return describePhaseProgress({ phase: null, ...totals }).detail;
}

function createInitiativeGroup(state: ShinsaState, initiative: Initiative, items: QueueItem[]): QueueGroup {
  return {
    kind: 'initiative',
    id: initiative.id,
    key: `initiative:${initiative.id}`,
    title: initiative.name,
    progress: describeInitiativeGroupProgress(state, initiative),
    opens: selectInitiativeLead(state, initiative),
    root: null,
    members: items,
  };
}

function createBundleGroup(state: ShinsaState, items: QueueItem[], root: QueueItem): QueueGroup {
  const bundle = resolveBundle(state, root.task);
  const order = new Map(bundle.map((member, index) => [member.id, index]));
  const id = bundle[0]?.id ?? root.task.id;
  const rank = (item: QueueItem) => order.get(item.task.id) ?? order.size;
  const [first = root, ...members] = [...items].sort((a, b) => rank(a) - rank(b));
  return {
    kind: 'bundle',
    id,
    key: `bundle:${id}`,
    title: first.task.title,
    progress: describeBundleProgress(listBundleRows(state, first.task)),
    opens: first.task,
    root: first,
    members,
  };
}

function createGroup(state: ShinsaState, items: QueueItem[], first: QueueItem): QueueGroup {
  const initiative = selectGroupInitiative(state, first.task);
  if (initiative) return createInitiativeGroup(state, initiative, items);
  return createBundleGroup(state, items, first);
}

export function listSectionEntries(state: ShinsaState, items: QueueItem[]): QueueEntry[] {
  const grouped = new Map<string, QueueItem[]>();
  for (const item of items) {
    const key = resolveGroupKey(state, item.task);
    if (key) grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  const placed = new Set<string>();
  return items.flatMap((item): QueueEntry[] => {
    const key = resolveGroupKey(state, item.task);
    const members = key ? (grouped.get(key) ?? []) : [];
    if (!key || members.length < 2) return [{ kind: 'item', item }];
    if (placed.has(key)) return [];
    placed.add(key);
    return [{ kind: 'group', group: createGroup(state, members, item) }];
  });
}

export function countGroupTasks(group: QueueGroup) {
  return group.members.length + (group.root ? 1 : 0);
}

export function countSectionEntries(entries: QueueEntry[], isOpen: (group: QueueGroup) => boolean) {
  return entries.reduce((count, entry) => {
    if (entry.kind === 'item') return count + 1;
    return count + (isOpen(entry.group) ? countGroupTasks(entry.group) : 1);
  }, 0);
}

export function resolveGroupId(
  scope: Extract<DisclosureScope, 'home' | 'queue'>,
  section: QueueSection,
  group: QueueGroup
) {
  return createDisclosureId(scope, 'group', section.key, group.kind, group.id);
}

function holdsTask(group: QueueGroup, taskId: string | null) {
  return [group.root, ...group.members].some((item) => item !== null && item.task.id === taskId);
}

export function resolveGroupDefault(section: QueueSection, group: QueueGroup, activeTaskId: string | null) {
  return section.key === 'working' || holdsTask(group, activeTaskId);
}

function createGroupSection(
  state: ShinsaState,
  key: 'working' | 'waiting' | 'snoozed',
  items: QueueItem[],
  empty: string | null
): QueueSection {
  const group = key === 'waiting' ? WAITING_GROUP : TASK_GROUP[key];
  return {
    key,
    title: group.title,
    icon: group.icon,
    tone: group.tone,
    items,
    entries: listSectionEntries(state, items),
    empty,
    startsCollapsed: key !== 'working',
    opensOnHome: key !== 'snoozed',
  };
}

export function listQueueSections(state: ShinsaState, queue: Queue): QueueSection[] {
  const listed = (task: Task) => !isLeadTask(task);
  const gates = listGateItems(queue.ready);
  return [
    {
      key: 'needs',
      title: 'Needs you',
      icon: 'IconInboxEmpty',
      tone: 'neutral',
      items: gates,
      entries: gates.map((item) => ({ kind: 'item' as const, item })),
      empty: 'Nothing is waiting on you.',
      startsCollapsed: false,
      opensOnHome: true,
    },
    createGroupSection(
      state,
      'working',
      [
        ...queue.working.filter(listed).map((task) => ({
          kind: 'working' as const,
          key: task.id,
          task,
          since: task.stageChangedAt,
          sinceLabel: 'Step started',
        })),
      ],
      'No agent is working right now.'
    ),
    createGroupSection(
      state,
      'waiting',
      orderChains(state, queue.waiting.filter(listed)).map(({ task }) => ({
        kind: 'idle',
        key: task.id,
        task,
        since: task.createdAt,
        sinceLabel: 'Asked for',
      })),
      null
    ),
    createGroupSection(
      state,
      'snoozed',
      queue.snoozed.filter(listed).map((task) => ({
        kind: 'idle',
        key: task.id,
        task,
        since: task.snoozed?.at ?? task.updatedAt,
        sinceLabel: 'Snoozed',
      })),
      null
    ),
  ];
}

export function resolveSectionId(section: QueueSection) {
  return createDisclosureId('queue', 'section', section.key);
}

export function resolveSectionDefault(section: QueueSection, activeTaskId: string | null) {
  return !section.startsCollapsed || section.items.some((item) => item.task.id === activeTaskId);
}

export function describeNeedsCount(count: number) {
  if (count === 0) return 'Nothing needs you';
  return count === 1 ? '1 needs you' : `${count} need you`;
}

const ROUTES_WITHOUT_QUEUE_BUTTON: Route['name'][] = ['home', 'tasks', 'onboarding'];

export function isQueueButtonShown(route: Route) {
  return !ROUTES_WITHOUT_QUEUE_BUTTON.includes(route.name);
}
