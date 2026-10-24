import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  isTaskSettled,
  resolveRoundTitle,
  type Task,
  type TaskSuggestion,
} from '../domain/index.ts';
import type { Decider } from './decider.ts';
import { assertTakesMessages, queueRound } from './rounds.ts';
import { findCurrentRun } from './runs.ts';
import { createTask } from './tasks.ts';

const MAX_OPEN_SUGGESTIONS = 10;

function normalize(title: string) {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function listKnownTitles(decider: Decider, task: Task) {
  const own = (task.suggestions ?? []).map((suggestion) => normalize(suggestion.title));
  const open = Object.values(decider.state.tasks)
    .filter((candidate) => !isTaskSettled(candidate))
    .map((candidate) => normalize(candidate.title));
  return new Set([...own, ...open]);
}

function countOpen(task: Task) {
  return (task.suggestions ?? []).filter((suggestion) => suggestion.status === 'open').length;
}

export function hasRoomForSuggestion(task: Task) {
  return countOpen(task) < MAX_OPEN_SUGGESTIONS;
}

export function suggestSplitOff(
  decider: Decider,
  taskId: string,
  request: string,
  title: string | null,
  why: string | null
) {
  decider.emit({
    type: 'task.suggested',
    taskId,
    suggestion: {
      id: decider.context.newId(),
      runId: null,
      title: title?.trim() || resolveRoundTitle(request),
      request,
      why: why?.trim() || 'It does not belong to this task.',
      waitsOnThis: false,
      status: 'open',
      createdTaskId: null,
      suggestedAt: decider.context.now,
      splitOff: true,
    },
  });
}

export function suggestTasks(decider: Decider, command: CommandOf<'agent.suggest_tasks'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'suggest_tasks');
  const known = listKnownTitles(decider, task);
  const fresh = command.suggestions.filter((suggestion) => {
    const title = normalize(suggestion.title);
    if (known.has(title)) return false;
    known.add(title);
    return true;
  });
  const open = countOpen(task);
  if (open + fresh.length > MAX_OPEN_SUGGESTIONS) {
    throw new DomainError(
      'suggestions_full',
      `This task already has ${open} open suggestions. Leave the rest for the human to look at.`
    );
  }
  for (const suggestion of fresh) {
    decider.emit({
      type: 'task.suggested',
      taskId: task.id,
      suggestion: {
        id: decider.context.newId(),
        runId: run.id,
        title: suggestion.title.trim(),
        request: suggestion.request.trim(),
        why: suggestion.why.trim(),
        waitsOnThis: suggestion.waitsOnThis,
        status: 'open',
        createdTaskId: null,
        suggestedAt: decider.context.now,
        ...(suggestion.splitOff ? { splitOff: true } : {}),
      },
    });
  }
}

function findOpenSuggestion(decider: Decider, taskId: string, suggestionId: string): TaskSuggestion {
  const suggestion = decider.task(taskId).suggestions?.find((candidate) => candidate.id === suggestionId);
  if (!suggestion) throw new DomainError('suggestion_not_found', `No suggestion ${suggestionId}`);
  if (suggestion.status !== 'open') {
    throw new DomainError('suggestion_closed', 'This suggestion has already been added or dismissed.');
  }
  return suggestion;
}

export function acceptSuggestion(decider: Decider, command: CommandOf<'suggestion.accept'>) {
  const suggestion = findOpenSuggestion(decider, command.taskId, command.suggestionId);
  const parent = decider.task(command.taskId);
  const createdTaskId = createTask(decider, {
    type: 'task.create',
    request: suggestion.request,
    repoId: parent.repoId,
    priority: parent.priority,
    origin: parent.origin,
    waitsOn: command.waitsOnThis ? [parent.id] : [],
  });
  decider.emit({
    type: 'suggestion.settled',
    taskId: parent.id,
    suggestionId: suggestion.id,
    status: 'accepted',
    createdTaskId,
  });
}

export function dismissSuggestion(decider: Decider, command: CommandOf<'suggestion.dismiss'>) {
  const suggestion = findOpenSuggestion(decider, command.taskId, command.suggestionId);
  decider.emit({
    type: 'suggestion.settled',
    taskId: command.taskId,
    suggestionId: suggestion.id,
    status: 'dismissed',
    createdTaskId: null,
  });
}

export function keepSuggestion(decider: Decider, command: CommandOf<'suggestion.keep'>) {
  const suggestion = findOpenSuggestion(decider, command.taskId, command.suggestionId);
  assertTakesMessages(decider.task(command.taskId));
  const keptRound = queueRound(decider, command.taskId, {
    request: suggestion.request,
    title: suggestion.title,
    why: suggestion.why,
    shape: null,
  });
  decider.emit({
    type: 'suggestion.settled',
    taskId: command.taskId,
    suggestionId: suggestion.id,
    status: 'dismissed',
    createdTaskId: null,
    keptRound,
  });
}
