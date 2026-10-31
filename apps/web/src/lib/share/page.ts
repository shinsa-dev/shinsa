import type { SharedTask, Task } from '@shinsa/core';
import { hasReview } from '@/lib/tasks/tabs.ts';

export type SharedTab = 'overview' | 'review' | 'code';

export const SHARED_TAB_LABEL: Record<SharedTab, string> = {
  overview: 'Overview',
  review: 'Review',
  code: 'Code',
};

export const SHARED_PREVIEW_NOTE =
  'A preview of what anyone with the link sees. Chats, activity and notes never leave this machine.';

export const SHARED_READ_ONLY_NOTE = 'Read-only. Only its owner can change this task, from their own Shinsa.';

export const NO_PLAN_YET = 'No plan yet. It shows here once the agent proposes one.';

export function listSharedTabs(task: Task, shared: SharedTask): SharedTab[] {
  const review = hasReview(task) && (task.report !== null || shared.code);
  return ['overview', ...(review ? ['review' as const] : []), ...(shared.code ? ['code' as const] : [])];
}

export function resolveSharedTab(tabs: readonly SharedTab[], requested: string | null): SharedTab {
  return tabs.find((tab) => tab === requested) ?? 'overview';
}

export function describeSharedBy(shared: SharedTask, viewer: string | null) {
  const mine = shared.owner !== null && shared.owner.toLowerCase() === viewer?.toLowerCase();
  const owner = mine ? 'you' : shared.owner && `@${shared.owner}`;
  if (owner && shared.machine) return `Shared by ${owner} from ${shared.machine}`;
  if (owner) return `Shared by ${owner}`;
  if (shared.machine) return `Shared from ${shared.machine}`;
  return 'Shared';
}
