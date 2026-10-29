import { isMemoryOf, type MemoryEntry } from '../domain/memory.ts';
import type { EventOf, ShinsaEvent } from '../events/index.ts';
import { removeEntry, writeEntry } from './draft.ts';
import type { ShinsaState } from './project.ts';
import { record } from './write.ts';

type MemoryEvent = Extract<ShinsaEvent, { type: 'memory.written' | 'memory.proposed' | 'memory.removed' }>;

function applyProposed(state: ShinsaState, event: EventOf<'memory.proposed'>) {
  writeEntry(state, 'memories', event.entry.id, event.entry);
  if (!event.entry.taskId) return;
  record(state, event.entry.taskId, event.at, {
    actor: 'agent',
    kind: 'suggestion',
    text: 'Proposed a rule for agents to remember',
    detail: event.entry.text,
    runId: event.entry.runId,
  });
}

export function applyMemoryEvent(state: ShinsaState, event: MemoryEvent) {
  switch (event.type) {
    case 'memory.written':
      writeEntry(state, 'memories', event.entry.id, event.entry);
      return;
    case 'memory.proposed':
      applyProposed(state, event);
      return;
    case 'memory.removed':
      removeEntry(state, 'memories', event.memoryId);
      return;
  }
}

function compareMemory(left: MemoryEntry, right: MemoryEntry) {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

export function listMemory(state: ShinsaState): MemoryEntry[] {
  return Object.values(state.memories).sort(compareMemory);
}

export function listKeptMemory(state: ShinsaState, projectId: string | null): MemoryEntry[] {
  return listMemory(state).filter((entry) => entry.status === 'kept' && isMemoryOf(entry, projectId));
}
