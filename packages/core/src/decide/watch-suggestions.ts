import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  isScheduleLive,
  resolveSuggestedWatchName,
  resolveSuggestedWatchText,
  SCHEDULE_LIMITS,
  type WatchSuggestion,
} from '../domain/index.ts';
import { isTimeZone } from '../schedules/time.ts';
import { listOpenWatchSuggestions, listWatchSuggestions } from '../state/watch-suggestions.ts';
import type { Decider } from './decider.ts';
import { selectProjectSource } from './intake.ts';

export type WatchSuggestionInput = Omit<
  WatchSuggestion,
  'id' | 'status' | 'scheduleId' | 'createdAt' | 'decidedAt'
>;

function isWatched(decider: Decider, projectId: string, server: string) {
  return Object.values(decider.state.schedules).some(
    (schedule) =>
      isScheduleLive(schedule) &&
      schedule.source?.projectId === projectId &&
      schedule.source.server === server
  );
}

function wasSuggested(decider: Decider, projectId: string, server: string) {
  return listWatchSuggestions(decider.state).some(
    (suggestion) => suggestion.projectId === projectId && suggestion.server === server
  );
}

function selectSameOpen(decider: Decider, input: WatchSuggestionInput) {
  return (
    listOpenWatchSuggestions(decider.state, input.projectId).find(
      (suggestion) =>
        suggestion.server === input.server &&
        suggestion.text === input.text &&
        suggestion.origin.kind === input.origin.kind
    ) ?? null
  );
}

export function suggestWatch(decider: Decider, input: WatchSuggestionInput) {
  const same = selectSameOpen(decider, input);
  if (same) return same.id;
  if (listOpenWatchSuggestions(decider.state).length >= SCHEDULE_LIMITS.openSuggestions) {
    throw new DomainError(
      'suggestion_limit',
      `${SCHEDULE_LIMITS.openSuggestions} suggested watches already wait for the human. Ask them to accept or dismiss one first.`
    );
  }
  const suggestion: WatchSuggestion = {
    id: decider.context.newId(),
    ...input,
    status: 'open',
    scheduleId: null,
    createdAt: decider.context.now,
    decidedAt: null,
  };
  decider.emit({ type: 'watch_suggestion.recorded', suggestion });
  return suggestion.id;
}

export function recordWatchSuggestion(decider: Decider, command: CommandOf<'watch_suggestion.record'>) {
  const server = command.server.trim();
  const source = { projectId: command.projectId, server };
  if (!selectProjectSource(decider, source)) return;
  if (isWatched(decider, command.projectId, server) || wasSuggested(decider, command.projectId, server))
    return;
  if (listOpenWatchSuggestions(decider.state).length >= SCHEDULE_LIMITS.openSuggestions) return;
  suggestWatch(decider, {
    projectId: command.projectId,
    server,
    name: (command.name?.trim() || resolveSuggestedWatchName(server)).slice(0, SCHEDULE_LIMITS.name),
    text: (command.text?.trim() || resolveSuggestedWatchText(server)).slice(0, SCHEDULE_LIMITS.text),
    trigger: { kind: 'interval', everyMinutes: SCHEDULE_LIMITS.suggestedEveryMinutes },
    timeZone: isTimeZone(command.timeZone) ? command.timeZone : 'UTC',
    maxRuns: null,
    origin: { kind: 'source' },
  });
}

export function findOpenWatchSuggestion(decider: Decider, suggestionId: string) {
  const suggestion = decider.state.watchSuggestions[suggestionId];
  if (!suggestion) throw new DomainError('suggestion_not_found', `No suggested watch ${suggestionId}.`);
  if (suggestion.status !== 'open') {
    throw new DomainError(
      'suggestion_decided',
      `The suggested watch “${suggestion.name}” was already ${suggestion.status}.`
    );
  }
  return suggestion;
}

export function dismissWatchSuggestion(decider: Decider, command: CommandOf<'watch_suggestion.dismiss'>) {
  const suggestion = findOpenWatchSuggestion(decider, command.suggestionId);
  decider.emit({ type: 'watch_suggestion.dismissed', suggestionId: suggestion.id });
}

export function removeSourceSuggestions(decider: Decider, projectId: string, server: string) {
  for (const suggestion of listOpenWatchSuggestions(decider.state, projectId)) {
    if (suggestion.server !== server) continue;
    decider.emit({ type: 'watch_suggestion.removed', suggestionId: suggestion.id });
  }
}

export function removeProjectSuggestions(decider: Decider, projectId: string) {
  for (const suggestion of listWatchSuggestions(decider.state)) {
    if (suggestion.projectId !== projectId) continue;
    decider.emit({ type: 'watch_suggestion.removed', suggestionId: suggestion.id });
  }
}
