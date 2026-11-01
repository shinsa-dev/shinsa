import { hasShareGroup, lowerFirst, type SharedTask, type Task } from '@shinsa/core';
import { resolveFirstName, resolveSharedProfile, type UserProfile } from '@/lib/remote/users.ts';
import { listTaskTabs, type TaskTab } from '@/lib/tasks/tabs.ts';

export const SHARED_READ_ONLY_NOTE = 'Read-only';

export function listSharedTabs(task: Task, shared: SharedTask): TaskTab[] {
  const chat = hasShareGroup(shared.preset, 'live');
  return listTaskTabs(task).filter((tab) => (tab !== 'chat' || chat) && (tab !== 'code' || shared.code));
}

export const UNKNOWN_OWNER = 'The owner';

export interface SharedOwner {
  name: string;
  user: UserProfile | null;
}

export function resolveOwnerName(shared: SharedTask, viewer: string | null): SharedOwner | null {
  if (shared.owner === null) return { name: UNKNOWN_OWNER, user: null };
  if (shared.owner.toLowerCase() === viewer?.toLowerCase()) return null;
  const user = resolveSharedProfile(shared.owner, shared.ownerProfile);
  return { name: resolveFirstName(user), user };
}

export function describeOwnerInSentence(owner: string) {
  return owner === UNKNOWN_OWNER ? lowerFirst(owner) : owner;
}

export function describeOwnerPossessive(owner: string | null) {
  return owner === null ? 'your' : `${describeOwnerInSentence(owner)}’s`;
}

export function describeSharedBy(shared: SharedTask, viewer: string | null) {
  const owner = shared.owner && (resolveOwnerName(shared, viewer)?.name ?? 'you');
  if (owner && shared.machine) return `Shared by ${owner} from ${shared.machine}`;
  if (owner) return `Shared by ${owner}`;
  if (shared.machine) return `Shared from ${shared.machine}`;
  return 'Shared';
}
