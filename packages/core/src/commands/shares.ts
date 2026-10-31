import type { ShareLimit } from '../domain/settings.ts';

export type ShareUserCommand =
  | { type: 'task.share'; taskId: string; limit?: ShareLimit }
  | { type: 'task.unshare'; taskId: string };

export type ShareSystemCommand =
  | { type: 'share.record'; taskId: string; url: string | null }
  | { type: 'share.fail'; taskId: string; detail: string }
  | { type: 'share.expire'; taskId: string };
