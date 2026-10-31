import type { GateType, Queue, QueuedGate, ShinsaState, Task } from '../../src/index.ts';

export const NOW = 10 * 24 * 60 * 60 * 1000;

export function task(id: string, title: string, extra: Partial<Task> = {}) {
  return { id, title, stage: 'awaiting_review', pullRequest: null, ...extra } as Task;
}

export function entry(
  taskValue: Task,
  type: GateType,
  extra: { unblocks?: number; openedAt?: number; title?: string } = {}
) {
  return {
    task: taskValue,
    gate: {
      id: `g-${taskValue.id}-${type}`,
      type,
      title: extra.title ?? 'Decide',
      openedAt: extra.openedAt ?? NOW - 60_000,
    },
    projectId: null,
    unblocks: extra.unblocks ?? 0,
    reason: '',
  } as unknown as QueuedGate;
}

export function queueOf(entries: QueuedGate[], extra: Partial<Queue> = {}): Queue {
  return {
    focusProjectId: null,
    ready: entries,
    upNow: entries,
    later: [],
    working: [],
    waiting: [],
    backlog: [],
    snoozed: [],
    ...extra,
  };
}

export const chat = task('t-chat', 'Embedded chat rework');
export const dup = task('t-dup', 'Fix code-first duplicate', {
  pullRequest: { number: 42 } as Task['pullRequest'],
});
export const docs = task('t-docs', 'Document the engine');
export const tools = task('t-tools', 'Tool calls in chat', { stage: 'building' });

export const ready = [entry(chat, 'review', { unblocks: 1 }), entry(dup, 'merge'), entry(docs, 'plan')];

export function stateOf(tasks: Task[]) {
  return { tasks: Object.fromEntries(tasks.map((value) => [value.id, value])) } as unknown as ShinsaState;
}
