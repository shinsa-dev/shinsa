import type { MemoryEntry } from '../domain/memory.ts';

export type MemoryEventBody =
  | { type: 'memory.written'; entry: MemoryEntry }
  | { type: 'memory.proposed'; entry: MemoryEntry }
  | { type: 'memory.removed'; memoryId: string };
