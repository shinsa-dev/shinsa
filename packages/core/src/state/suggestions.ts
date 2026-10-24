import type { EventOf } from '../events/index.ts';
import { describeSuggestionSettled } from './activity.ts';
import type { ShinsaState } from './project.ts';
import { record, updateTask } from './write.ts';

export function applySuggested(state: ShinsaState, event: EventOf<'task.suggested'>) {
  updateTask(state, event.taskId, event.at, {
    suggestions: [...(state.tasks[event.taskId]?.suggestions ?? []), event.suggestion],
  });
  record(state, event.taskId, event.at, {
    actor: event.suggestion.runId ? 'agent' : 'shinsa',
    kind: 'suggestion',
    text: event.suggestion.splitOff
      ? `Suggested a separate task: ${event.suggestion.title}`
      : `Suggested a follow-up: ${event.suggestion.title}`,
    detail: event.suggestion.why,
    runId: event.suggestion.runId,
  });
}

export function applySuggestionSettled(state: ShinsaState, event: EventOf<'suggestion.settled'>) {
  const task = state.tasks[event.taskId];
  const suggestion = task?.suggestions?.find((candidate) => candidate.id === event.suggestionId);
  if (!task || !suggestion) return;
  updateTask(state, event.taskId, event.at, {
    suggestions: (task.suggestions ?? []).map((candidate) =>
      candidate.id === event.suggestionId
        ? {
            ...candidate,
            status: event.status,
            createdTaskId: event.createdTaskId,
            ...(event.keptRound === undefined ? {} : { keptRound: event.keptRound }),
          }
        : candidate
    ),
  });
  record(state, event.taskId, event.at, {
    actor: 'you',
    kind: 'suggestion',
    text:
      event.keptRound === undefined
        ? describeSuggestionSettled(event.status, suggestion.title)
        : `Kept “${suggestion.title}” in this task as round ${event.keptRound}`,
  });
}
