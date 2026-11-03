import type { MemoryEntry, ShinsaEventInput } from '../../packages/core/src/index.ts';
import { HOUR } from '../kit/time.ts';
import { NOW } from './kit.ts';

function createSeedRule(
  at: number,
  id: string,
  text: string,
  overrides: Partial<MemoryEntry> = {}
): MemoryEntry {
  return {
    id,
    projectId: null,
    text,
    why: null,
    status: 'kept',
    taskId: null,
    runId: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

export function pushSeedMemory(start: number, push: (at: number, event: ShinsaEventInput) => void) {
  const kept = [
    createSeedRule(start, 'memory-dashes', 'Never use em dashes in UI copy or messages.'),
    createSeedRule(start + 1, 'memory-terse', 'Keep hand-overs short: lead with the result, no recap.'),
    createSeedRule(start + 2, 'memory-swift', 'Keep the Swift SDK’s public API source compatible.', {
      projectId: 'project-basket',
    }),
  ];
  for (const entry of kept) push(entry.createdAt, { type: 'memory.written', entry });
  const proposal = createSeedRule(NOW - 2 * HOUR, 'memory-plans', 'Keep plans to three phases or fewer.', {
    status: 'proposed',
    projectId: 'project-basket',
    why: 'You asked for a shorter plan twice on the checkout redesign.',
  });
  push(proposal.createdAt, { type: 'memory.proposed', entry: proposal });
}
