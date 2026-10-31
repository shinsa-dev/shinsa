import type { ShareLimit } from '../domain/settings.ts';
import type { ShareEnd } from '../domain/types.ts';

export type ShareEventBody =
  | { type: 'task.shared'; taskId: string; limit: ShareLimit; endsAt: number | null }
  | { type: 'task.unshared'; taskId: string; reason: ShareEnd }
  | { type: 'share.recorded'; taskId: string; url: string | null }
  | { type: 'share.failed'; taskId: string; detail: string };
