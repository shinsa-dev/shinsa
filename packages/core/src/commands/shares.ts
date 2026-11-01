import type { ShareLimit } from '../domain/settings.ts';

export type ShareUserCommand =
  | { type: 'task.share'; taskId: string; limit?: ShareLimit }
  | { type: 'task.unshare'; taskId: string }
  | { type: 'preview.share'; taskId: string; serviceId: string; limit?: ShareLimit }
  | { type: 'preview.unshare'; taskId: string; serviceId: string };

export type ShareSystemCommand =
  | { type: 'share.record'; taskId: string; url: string | null }
  | { type: 'share.fail'; taskId: string; detail: string }
  | { type: 'share.expire'; taskId: string }
  | { type: 'preview.record'; taskId: string; serviceId: string; url: string | null }
  | { type: 'preview.fail'; taskId: string; serviceId: string; detail: string }
  | { type: 'preview.expire'; taskId: string; serviceId: string };
