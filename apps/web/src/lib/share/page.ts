import type { SharedTask, Task } from '@shinsa/core';
import { listTaskTabs, type TaskTab } from '@/lib/tasks/tabs.ts';

export const SHARED_READ_ONLY_NOTE = 'Read-only';

export function listSharedTabs(task: Task, shared: SharedTask): TaskTab[] {
  return listTaskTabs(task).filter((tab) => tab !== 'chat' && (tab !== 'code' || shared.code));
}

export function describeSharedBy(shared: SharedTask, viewer: string | null) {
  const mine = shared.owner !== null && shared.owner.toLowerCase() === viewer?.toLowerCase();
  const owner = mine ? 'you' : shared.owner && `@${shared.owner}`;
  if (owner && shared.machine) return `Shared by ${owner} from ${shared.machine}`;
  if (owner) return `Shared by ${owner}`;
  if (shared.machine) return `Shared from ${shared.machine}`;
  return 'Shared';
}
