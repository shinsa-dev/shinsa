import type { Gate, Queue, QueuedGate, ShinsaState, Task } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import type { Tone } from '@/lib/format/tone.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import { orderChains, ROADMAP_GROUP } from '@/lib/tasks/roadmap.ts';

export type QueueItem =
  | { kind: 'gate'; key: string; task: Task; gate: Gate; since: number; sinceLabel: string }
  | { kind: 'working' | 'idle'; key: string; task: Task; since: number; sinceLabel: string };

export interface QueueSection {
  key: 'needs' | 'working' | 'waiting';
  title: string;
  icon: IconName;
  tone: Tone;
  items: QueueItem[];
  empty: string | null;
  startsCollapsed: boolean;
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

function createGroupSection(
  key: 'working' | 'waiting',
  items: QueueItem[],
  empty: string | null
): QueueSection {
  const group = ROADMAP_GROUP[key];
  return {
    key,
    title: group.title,
    icon: group.icon,
    tone: group.tone,
    items,
    empty,
    startsCollapsed: key !== 'working',
  };
}

export function listQueueSections(state: ShinsaState, queue: Queue): QueueSection[] {
  return [
    {
      key: 'needs',
      title: 'Needs you',
      icon: 'IconInboxEmpty',
      tone: 'neutral',
      items: listGateItems(queue.ready),
      empty: 'Nothing is waiting on you.',
      startsCollapsed: false,
    },
    createGroupSection(
      'working',
      queue.working.map((task) => ({
        kind: 'working',
        key: task.id,
        task,
        since: task.stageChangedAt,
        sinceLabel: 'Step started',
      })),
      'No agent is working right now.'
    ),
    createGroupSection(
      'waiting',
      orderChains(state, queue.waiting).map(({ task }) => ({
        kind: 'idle',
        key: task.id,
        task,
        since: task.createdAt,
        sinceLabel: 'Asked for',
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
