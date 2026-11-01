import { hasShareGroup, lowerFirst, type SharedTask, type Task } from '@shinsa/core';
import { listTaskTabs, type TaskTab } from '@/lib/tasks/tabs.ts';

export const SHARED_READ_ONLY_NOTE = 'Read-only';

export function listSharedTabs(task: Task, shared: SharedTask): TaskTab[] {
  const chat = hasShareGroup(shared.preset, 'live');
  return listTaskTabs(task).filter((tab) => (tab !== 'chat' || chat) && (tab !== 'code' || shared.code));
}

export function resolveOwnerName(shared: SharedTask, viewer: string | null) {
  if (shared.owner === null) return 'The owner';
  if (shared.owner.toLowerCase() === viewer?.toLowerCase()) return null;
  return `@${shared.owner}`;
}

export function describeOwnerPossessive(owner: string | null) {
  return owner === null ? 'your' : `${lowerFirst(owner)}’s`;
}

export function describeSharedBy(shared: SharedTask, viewer: string | null) {
  const owner = shared.owner && (resolveOwnerName(shared, viewer) ?? 'you');
  if (owner && shared.machine) return `Shared by ${owner} from ${shared.machine}`;
  if (owner) return `Shared by ${owner}`;
  if (shared.machine) return `Shared from ${shared.machine}`;
  return 'Shared';
}
