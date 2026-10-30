import type { WatchSuggestion } from '../domain/index.ts';
import type { EventOf, ShinsaEvent } from '../events/index.ts';
import { removeEntry, writeEntry } from './draft.ts';
import type { ShinsaState } from './project.ts';
import { record } from './write.ts';

type WatchSuggestionEvent = Extract<
  ShinsaEvent,
  {
    type:
      | 'watch_suggestion.recorded'
      | 'watch_suggestion.accepted'
      | 'watch_suggestion.dismissed'
      | 'watch_suggestion.removed';
  }
>;

function applyRecorded(state: ShinsaState, event: EventOf<'watch_suggestion.recorded'>) {
  const { suggestion } = event;
  writeEntry(state, 'watchSuggestions', suggestion.id, suggestion);
  if (suggestion.origin.kind !== 'agent' || !suggestion.origin.taskId) return;
  record(state, suggestion.origin.taskId, event.at, {
    actor: 'agent',
    kind: 'suggestion',
    text: `Suggested the watch “${suggestion.name}”`,
    detail: suggestion.text,
    runId: suggestion.origin.runId,
  });
}

function decide(state: ShinsaState, suggestionId: string, patch: Partial<WatchSuggestion>, at: number) {
  const suggestion = state.watchSuggestions[suggestionId];
  if (!suggestion) return;
  writeEntry(state, 'watchSuggestions', suggestionId, { ...suggestion, ...patch, decidedAt: at });
}

export function applyWatchSuggestionEvent(state: ShinsaState, event: WatchSuggestionEvent) {
  switch (event.type) {
    case 'watch_suggestion.recorded':
      applyRecorded(state, event);
      return;
    case 'watch_suggestion.accepted':
      decide(state, event.suggestionId, { status: 'accepted', scheduleId: event.scheduleId }, event.at);
      return;
    case 'watch_suggestion.dismissed':
      decide(state, event.suggestionId, { status: 'dismissed' }, event.at);
      return;
    case 'watch_suggestion.removed':
      removeEntry(state, 'watchSuggestions', event.suggestionId);
      return;
  }
}

function compareSuggestions(left: WatchSuggestion, right: WatchSuggestion) {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

export function listWatchSuggestions(state: ShinsaState): WatchSuggestion[] {
  return Object.values(state.watchSuggestions).sort(compareSuggestions);
}

export function listOpenWatchSuggestions(state: ShinsaState, projectId: string | null = null) {
  return listWatchSuggestions(state).filter(
    (suggestion) => suggestion.status === 'open' && (projectId === null || suggestion.projectId === projectId)
  );
}
