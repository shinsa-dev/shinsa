import type { Queue } from '../queue/types.ts';
import { listBriefingEntries, listNamedIds, resolveFallbackBriefing } from './fallback.ts';
import { resolveNote } from './note.ts';
import type { Briefing, StoredBriefing } from './types.ts';

export function reconcileBriefing(stored: StoredBriefing | undefined, queue: Queue, now: number): Briefing {
  const fallback = resolveFallbackBriefing(queue, now);
  const briefing = stored?.briefing;
  if (!briefing?.now) return fallback;
  const nowId = briefing.now.taskId;
  const live = new Set(listBriefingEntries(queue).map((entry) => entry.task.id));
  if (!live.has(nowId)) return fallback;
  const kept = briefing.next.filter((item) => item.taskId !== nowId && live.has(item.taskId));
  const next = kept.length > 0 ? kept : fallback.next.filter((item) => item.taskId !== nowId);
  return {
    now: briefing.now,
    next,
    running: fallback.running,
    note: resolveNote(briefing.note, queue, listNamedIds(briefing.now, next), now),
  };
}
