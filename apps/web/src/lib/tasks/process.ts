import { MINUTE_MS, SILENCE_MINUTES, type Task, type TaskSuggestion } from '@shinsa/core';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import type { SuggestionStart } from '@/lib/tasks/suggestions.ts';

export const SNOOZE_HINT = `${SILENCE_MINUTES.snooze} minutes`;

export function requestCheckInNow(taskId: string) {
  return sendCommandWithToast({ type: 'monitor.check_in_now', taskId }, 'Checking in now.');
}

export function snoozeSilence(runId: string, now = Date.now()) {
  return sendCommandWithToast(
    { type: 'run.snooze_silence', runId, until: now + SILENCE_MINUTES.snooze * MINUTE_MS },
    `Snoozed for ${SNOOZE_HINT}.`
  );
}

export function dismissSilence(runId: string) {
  return sendCommandWithToast({ type: 'run.dismiss_silence', runId }, 'Dismissed for this step.');
}

export function acceptSuggestion(task: Task, suggestion: TaskSuggestion, start: SuggestionStart) {
  return sendCommandWithToast(
    {
      type: 'suggestion.accept',
      taskId: task.id,
      suggestionId: suggestion.id,
      waitsOnThis: start === 'after',
    },
    start === 'after'
      ? 'Added to the roadmap. It starts after this task merges.'
      : 'Added to the roadmap. It starts now.'
  );
}

export function dismissSuggestion(task: Task, suggestion: TaskSuggestion) {
  return sendCommandWithToast(
    { type: 'suggestion.dismiss', taskId: task.id, suggestionId: suggestion.id },
    'Dismissed.'
  );
}

export function keepSuggestion(task: Task, suggestion: TaskSuggestion) {
  return sendCommandWithToast(
    { type: 'suggestion.keep', taskId: task.id, suggestionId: suggestion.id },
    'Kept in this task. It starts as the next round.'
  );
}

export function stopDelegation(runId: string) {
  return sendCommandWithToast({ type: 'delegation.cancel', runId }, 'Stopped.');
}
