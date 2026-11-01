import type { TaskGuest } from '../domain/types.ts';

export type HandoffEventBody =
  | { type: 'task.handed_off'; taskId: string }
  | { type: 'handoff.recorded'; taskId: string; url: string }
  | { type: 'handoff.failed'; taskId: string; detail: string }
  | { type: 'handoff.claimed'; taskId: string; guest: TaskGuest }
  | { type: 'handoff.removed'; taskId: string; guest: TaskGuest | null };
