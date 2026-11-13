import { resolveComparableText } from '../chat/text.ts';
import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  hasStep,
  isTaskSettled,
  resolveRoundTitle,
  type Task,
  type TaskSuggestion,
} from '../domain/index.ts';
import type { Decider } from './decider.ts';
import { recordDecisions } from './lessons.ts';
import { findCurrentRun } from './runs.ts';
import { createTask } from './tasks.ts';

const MAX_OPEN_SUGGESTIONS = 10;

function listKnownTitles(decider: Decider, task: Task) {
  const own = (task.suggestions ?? []).map((suggestion) => resolveComparableText(suggestion.title));
  const open = Object.values(decider.state.tasks)
    .filter((candidate) => !isTaskSettled(candidate))
    .map((candidate) => resolveComparableText(candidate.title));
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
  suggestionId: string,
  request: string,
  title: string | null,
  why: string | null
) {
  decider.emit({
    type: 'task.suggested',
    taskId,
    suggestion: {
      id: suggestionId,
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

function assertCanStackOn(task: Task, suggestions: CommandOf<'agent.suggest_tasks'>['suggestions']) {
  const stacked = suggestions.filter((suggestion) => suggestion.stacksOnThis);
  if (stacked.length === 0) return;
  if (stacked.some((suggestion) => suggestion.waitsOnThis)) {
    throw new DomainError({
      code: 'dependency_cycle',
      message:
        'Set stack_on_this or after_this, not both: a bundled task already waits for this one to be ready and merges with it.',
    });
  }
  if (!hasStep(task, 'pull_request')) {
    throw new DomainError({
      code: 'stack_no_pull_request',
      message: 'This task opens no pull request, so nothing can be bundled with it. Leave stack_on_this out.',
    });
  }
}

export function suggestTasks(decider: Decider, command: CommandOf<'agent.suggest_tasks'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'suggest_tasks');
  assertCanStackOn(task, command.suggestions);
  const known = listKnownTitles(decider, task);
  const fresh = command.suggestions.filter((suggestion) => {
    const title = resolveComparableText(suggestion.title);
    if (known.has(title)) return false;
    known.add(title);
    return true;
  });
  const open = countOpen(task);
  if (open + fresh.length > MAX_OPEN_SUGGESTIONS) {
    throw new DomainError({
      code: 'suggestions_full',
      message: `This task already has ${open} open suggestions. Leave the rest for the human to look at.`,
    });
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
        ...(suggestion.stacksOnThis ? { stacksOnThis: true } : {}),
        status: 'open',
        createdTaskId: null,
        suggestedAt: decider.context.now,
        ...(suggestion.splitOff ? { splitOff: true } : {}),
      },
    });
  }
}

export function findOpenSuggestion(decider: Decider, taskId: string, suggestionId: string): TaskSuggestion {
  const suggestion = decider.task(taskId).suggestions?.find((candidate) => candidate.id === suggestionId);
  if (!suggestion)
    throw new DomainError({ code: 'suggestion_not_found', message: `No suggestion ${suggestionId}` });
  if (suggestion.status !== 'open') {
    throw new DomainError({ code: 'suggestion_closed', message: 'It was already added or dismissed.' });
  }
  return suggestion;
}

function assertOneStart(command: CommandOf<'suggestion.accept'>) {
  if (!command.stackOnThis || (!command.waitsOnThis && !command.backlog)) return;
  throw new DomainError({
    code: 'suggestion_start',
    message: 'Pick one way to start it: bundled with this task, after it merges, or in the backlog.',
  });
}

export function acceptSuggestion(decider: Decider, command: CommandOf<'suggestion.accept'>) {
  const suggestion = findOpenSuggestion(decider, command.taskId, command.suggestionId);
  assertOneStart(command);
  const parent = decider.task(command.taskId);
  const createdTaskId = createTask(decider, {
    type: 'task.create',
    request: suggestion.request,
    repoId: parent.repoId,
    priority: parent.priority,
    origin: parent.origin,
    waitsOn: command.waitsOnThis ? [parent.id] : [],
    ...(command.stackOnThis ? { stacksOn: [parent.id] } : {}),
    ...(command.backlog ? { backlog: true } : {}),
  });
  recordDecisions(decider, [
    { task: parent, gate: null, kind: 'suggestion', answer: 'accepted', note: suggestion.title },
  ]);
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
  recordDecisions(decider, [
    {
      task: decider.task(command.taskId),
      gate: null,
      kind: 'suggestion',
      answer: 'dismissed',
      note: suggestion.title,
    },
  ]);
  decider.emit({
    type: 'suggestion.settled',
    taskId: command.taskId,
    suggestionId: suggestion.id,
    status: 'dismissed',
    createdTaskId: null,
  });
}
