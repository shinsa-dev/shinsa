import {
  type Gate,
  isListedInFocus,
  type Queue,
  type QueuedGate,
  type ShinsaState,
  selectInitiativeLead,
  type Task,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import type { Tone } from '@/lib/format/tone.ts';
import { listInitiativeRows } from '@/lib/initiatives/view.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import { orderChains, TASK_GROUP } from '@/lib/tasks/groups.ts';
import type { Route } from '@/router.ts';

export type QueueItem =
  | { kind: 'gate'; key: string; task: Task; gate: Gate; since: number; sinceLabel: string }
  | {
      kind: 'working' | 'idle';
      key: string;
      task: Task;
      since: number;
      sinceLabel: string;
      initiative?: string;
    };

export interface QueueSection {
  key: 'needs' | 'working' | 'waiting' | 'snoozed';
  title: string;
  icon: IconName;
  tone: Tone;
  items: QueueItem[];
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

function createGroupSection(
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
    empty,
    startsCollapsed: key !== 'working',
    opensOnHome: key !== 'snoozed',
  };
}

function isInitiativeLeadItem(state: ShinsaState, task: Task) {
  const initiative = task.initiativeId ? state.initiatives[task.initiativeId] : undefined;
  return initiative?.leadTaskId === task.id && selectInitiativeLead(state, initiative) !== null;
}

function isNestedInInitiative(state: ShinsaState, task: Task) {
  const initiative = task.initiativeId ? state.initiatives[task.initiativeId] : undefined;
  const lead = initiative ? selectInitiativeLead(state, initiative) : null;
  return lead !== null && lead.id !== task.id;
}

function listInitiativeItems(state: ShinsaState, queue: Queue, now: number): QueueItem[] {
  const running = new Set(queue.working.map((task) => task.id));
  return listInitiativeRows(state)
    .filter(({ lead }) => !lead.snoozed && !lead.backlog && isListedInFocus(state, lead, now))
    .map(({ initiative, lead, summary }) => ({
      kind: running.has(lead.id) ? 'working' : 'idle',
      key: lead.id,
      task: lead,
      since: initiative.report?.at ?? lead.stageChangedAt,
      sinceLabel: initiative.report ? 'The lead last reported' : 'Started',
      initiative: summary,
    }));
}

export function listQueueSections(state: ShinsaState, queue: Queue, now: number): QueueSection[] {
  const nested = (task: Task) => isNestedInInitiative(state, task) || isInitiativeLeadItem(state, task);
  return [
    {
      key: 'needs',
      title: 'Needs you',
      icon: 'IconInboxEmpty',
      tone: 'neutral',
      items: listGateItems(queue.ready),
      empty: 'Nothing is waiting on you.',
      startsCollapsed: false,
      opensOnHome: true,
    },
    createGroupSection(
      'working',
      [
        ...listInitiativeItems(state, queue, now),
        ...queue.working
          .filter((task) => !nested(task))
          .map((task) => ({
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
      'waiting',
      orderChains(
        state,
        queue.waiting.filter((task) => !nested(task))
      ).map(({ task }) => ({
        kind: 'idle',
        key: task.id,
        task,
        since: task.createdAt,
        sinceLabel: 'Asked for',
      })),
      null
    ),
    createGroupSection(
      'snoozed',
      queue.snoozed.map((task) => ({
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
