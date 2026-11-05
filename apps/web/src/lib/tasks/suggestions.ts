import { hasStep, isTaskSettled, type Task, type TaskSuggestion } from '@shinsa/core';
import type { MenuItemIcon } from '@shinsa/ui/components/menu-icon';

export type SuggestionStart = 'now' | 'after' | 'bundle' | 'backlog';

interface SuggestionStartItem {
  value: SuggestionStart;
  label: string;
  icon: MenuItemIcon;
  hint?: string;
}

const START_ITEM: Record<SuggestionStart, SuggestionStartItem> = {
  now: { value: 'now', label: 'Start now', icon: 'IconRocket' },
  after: { value: 'after', label: 'After this task merges', icon: 'IconHourglass' },
  bundle: { value: 'bundle', label: 'Bundle with this task', icon: 'IconLayersThree' },
  backlog: { value: 'backlog', label: 'Backlog', icon: 'IconArchive' },
};

export const SUGGESTION_START_LABEL = 'When to start';

export function listOpenSuggestions(task: Task) {
  return (task.suggestions ?? []).filter((suggestion) => suggestion.status === 'open');
}

export function canBundleSuggestion(task: Task, supported: boolean) {
  return supported && hasStep(task, 'pull_request') && !isTaskSettled(task);
}

export function resolveSuggestionStart(suggestion: TaskSuggestion, canBundle: boolean): SuggestionStart {
  if (suggestion.stacksOnThis && canBundle) return 'bundle';
  return suggestion.waitsOnThis ? 'after' : 'now';
}

export function listSuggestionStarts(suggestion: TaskSuggestion, canBundle: boolean): SuggestionStartItem[] {
  const suggested = resolveSuggestionStart(suggestion, canBundle);
  const starts: SuggestionStart[] = canBundle ? ['now', 'after', 'bundle'] : ['now', 'after'];
  return [
    { ...START_ITEM[suggested], hint: 'Suggested' },
    ...starts.filter((start) => start !== suggested).map((start) => START_ITEM[start]),
    START_ITEM.backlog,
  ];
}
