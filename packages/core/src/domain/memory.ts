export type MemoryStatus = 'proposed' | 'kept';

export type MemoryScope = 'global' | 'project';

export const MEMORY_SCOPES: readonly [MemoryScope, ...MemoryScope[]] = ['global', 'project'];

export interface MemoryEntry {
  id: string;
  projectId: string | null;
  text: string;
  why: string | null;
  status: MemoryStatus;
  taskId: string | null;
  runId: string | null;
  createdAt: number;
  updatedAt: number;
}

export const MEMORY_LIMITS = {
  text: 240,
  why: 200,
  keptPerScope: 20,
  proposals: 10,
} as const;

export function isMemoryOf(entry: MemoryEntry, projectId: string | null) {
  return entry.projectId === null || entry.projectId === projectId;
}

export function resolveMemoryText(text: string) {
  return text.trim().replace(/\s+/g, ' ');
}
