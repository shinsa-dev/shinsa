import type { Task, TaskSuggestion } from '@shinsa/core';
import type { MenuItemIcon } from '@shinsa/ui/components/menu-icon';

export type FollowUpStart = 'now' | 'after';

interface FollowUpStartItem {
  value: FollowUpStart;
  label: string;
  icon: MenuItemIcon;
  hint?: string;
}

const START_ITEM: Record<FollowUpStart, FollowUpStartItem> = {
  now: { value: 'now', label: 'Start now', icon: 'IconRocket' },
  after: { value: 'after', label: 'After this task merges', icon: 'IconHourglass' },
};

export const FOLLOW_UP_START_LABEL = 'When to start';

export function listOpenSuggestions(task: Task) {
  return (task.suggestions ?? []).filter((suggestion) => suggestion.status === 'open');
}

export function resolveFollowUpStart(suggestion: TaskSuggestion): FollowUpStart {
  return suggestion.waitsOnThis ? 'after' : 'now';
}

export function listFollowUpStarts(suggestion: TaskSuggestion): FollowUpStartItem[] {
  const suggested = resolveFollowUpStart(suggestion);
  const other = suggested === 'after' ? 'now' : 'after';
  return [{ ...START_ITEM[suggested], hint: 'Suggested' }, START_ITEM[other]];
}
