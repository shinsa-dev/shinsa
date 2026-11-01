import type { ShareLimit } from '../domain/settings.ts';
import type { ShareEnd } from '../domain/types.ts';

export type ShareEventBody =
  | { type: 'task.shared'; taskId: string; limit: ShareLimit; endsAt: number | null }
  | { type: 'task.unshared'; taskId: string; reason: ShareEnd }
  | { type: 'share.recorded'; taskId: string; url: string | null }
  | { type: 'share.failed'; taskId: string; detail: string }
  | { type: 'preview.shared'; taskId: string; serviceId: string; limit: ShareLimit; endsAt: number | null }
  | { type: 'preview.unshared'; taskId: string; serviceId: string; reason: ShareEnd }
  | { type: 'preview.recorded'; taskId: string; serviceId: string; url: string | null }
  | { type: 'preview.failed'; taskId: string; serviceId: string; detail: string };
