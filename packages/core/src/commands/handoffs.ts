import type { TaskGuest } from '../domain/types.ts';

export type HandoffUserCommand =
  | { type: 'task.hand_off'; taskId: string }
  | { type: 'handoff.remove'; taskId: string };

export type HandoffSystemCommand =
  | { type: 'handoff.record'; taskId: string; url: string }
  | { type: 'handoff.fail'; taskId: string; detail: string }
  | { type: 'handoff.claim'; taskId: string; guest: TaskGuest };
