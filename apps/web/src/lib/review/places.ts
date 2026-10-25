import type { Task } from '@shinsa/core';
import { hasChanges } from '@/lib/tasks/tabs.ts';
import { resolveTaskPath } from '@/router.ts';

export interface CodePlace {
  file: string;
  start: number | null;
  end: number | null;
}

export function resolveCodePath(task: Task, place: CodePlace, spot: string | null = null) {
  const changed = hasChanges(task);
  return resolveTaskPath(task, {
    tab: 'code',
    mode: changed ? 'changes' : 'files',
    file: place.file,
    diff: changed,
    line: place.start,
    end: place.end,
    spot,
  });
}

export function resolveReviewPath(task: Task, spot: string | null = null) {
  return resolveTaskPath(task, { tab: 'review', spot });
}
