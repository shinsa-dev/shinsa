import { resolveCurrentRound, type Task } from '../domain/index.ts';
import type { EventOf } from '../events/index.ts';
import { describeSuggestionSettled } from './activity.ts';
import type { ShinsaState } from './project.ts';
import { record, updateTask } from './write.ts';

export function applySuggested(state: ShinsaState, event: EventOf<'task.suggested'>) {
  updateTask(state, event.taskId, event.at, {
    suggestions: [...(state.tasks[event.taskId]?.suggestions ?? []), { ...event.suggestion }],
  });
  record(state, event.taskId, event.at, {
    actor: event.suggestion.runId ? 'agent' : 'shinsa',
    kind: 'suggestion',
    text: event.suggestion.splitOff
      ? `Suggested a separate task: ${event.suggestion.title}`
      : `Suggested a task: ${event.suggestion.title}`,
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
    text: describeSettled(task, suggestion.title, event),
  });
}

function describeSettled(task: Task, title: string, event: EventOf<'suggestion.settled'>) {
  if (event.keptRound === undefined) return describeSuggestionSettled(event.status, title);
  if (event.keptRound === resolveCurrentRound(task).number) {
    return `Kept “${title}” in this task and sent it to the agent`;
  }
  return `Kept “${title}” in this task as round ${event.keptRound}`;
}
