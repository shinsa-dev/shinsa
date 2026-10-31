import type { Task, TaskSuggestion } from '@shinsa/core';
import type { MenuItemIcon } from '@shinsa/ui/components/menu-icon';

export type SuggestionStart = 'now' | 'after' | 'backlog';

interface SuggestionStartItem {
  value: SuggestionStart;
  label: string;
  icon: MenuItemIcon;
  hint?: string;
}

const START_ITEM: Record<SuggestionStart, SuggestionStartItem> = {
  now: { value: 'now', label: 'Start now', icon: 'IconRocket' },
  after: { value: 'after', label: 'After this task merges', icon: 'IconHourglass' },
  backlog: { value: 'backlog', label: 'Backlog', icon: 'IconArchive' },
};

export const SUGGESTION_START_LABEL = 'When to start';

export function listOpenSuggestions(task: Task) {
  return (task.suggestions ?? []).filter((suggestion) => suggestion.status === 'open');
}

export function resolveSuggestionStart(suggestion: TaskSuggestion): SuggestionStart {
  return suggestion.waitsOnThis ? 'after' : 'now';
}

export function listSuggestionStarts(suggestion: TaskSuggestion): SuggestionStartItem[] {
  const suggested = resolveSuggestionStart(suggestion);
  const other = suggested === 'after' ? 'now' : 'after';
  return [{ ...START_ITEM[suggested], hint: 'Suggested' }, START_ITEM[other], START_ITEM.backlog];
}
