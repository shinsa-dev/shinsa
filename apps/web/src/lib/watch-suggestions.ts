import {
  type ChatToolArgs,
  describeScheduleTrigger,
  listOpenWatchSuggestions,
  listWatchSuggestions,
  lowerFirst,
  type ShinsaState,
  type WatchSuggestion,
} from '@shinsa/core';
import { readString } from '@/lib/chat/tool-describe.ts';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';

export interface WatchSuggestionActions {
  accept: (suggestion: WatchSuggestion) => Promise<boolean>;
  dismiss: (suggestion: WatchSuggestion) => Promise<boolean>;
}

export const WATCH_SUGGESTION_ACTIONS: WatchSuggestionActions = {
  accept: (suggestion) =>
    sendCommandWithToast(
      { type: 'watch_suggestion.accept', suggestionId: suggestion.id },
      `Added the watch “${suggestion.name}”. It reads ${suggestion.server} from now on.`
    ),
  dismiss: (suggestion) =>
    sendCommandWithToast({ type: 'watch_suggestion.dismiss', suggestionId: suggestion.id }, 'Dismissed.'),
};

export function selectSourceSuggestion(state: ShinsaState, projectId: string, server: string) {
  return (
    listOpenWatchSuggestions(state, projectId).find((suggestion) => suggestion.server === server) ?? null
  );
}

export function describeSuggestionDetail(suggestion: WatchSuggestion, project: string | null = null) {
  const when = lowerFirst(describeScheduleTrigger(suggestion.trigger));
  return [suggestion.server, when, project].filter(Boolean).join(' · ');
}

export function resolveSuggestionProject(state: ShinsaState, suggestion: WatchSuggestion) {
  return state.projects[suggestion.projectId]?.name ?? null;
}

export function selectCallSuggestion(state: ShinsaState, taskId: string | null, args: ChatToolArgs) {
  const server = readString(args, 'source')?.trim();
  const text = readString(args, 'message')?.trim();
  return (
    listWatchSuggestions(state).find(
      (suggestion) =>
        suggestion.origin.kind === 'agent' &&
        suggestion.origin.taskId === taskId &&
        suggestion.server === server &&
        suggestion.text === text
    ) ?? null
  );
}

export function describeSuggestionStatus(suggestion: WatchSuggestion | null) {
  if (!suggestion) return 'No longer open';
  if (suggestion.status === 'accepted') return 'Added';
  if (suggestion.status === 'dismissed') return 'Dismissed';
  return 'Waits for you';
}
