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
import { weighSuggestion } from './autopilot.ts';
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
    const suggestionId = decider.context.newId();
    decider.emit({
      type: 'task.suggested',
      taskId: task.id,
      suggestion: {
        id: suggestionId,
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
    weighSuggestion(decider, task.id, suggestionId);
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

interface SuggestionStart {
  waitsOnThis: boolean;
  stackOnThis?: boolean;
  backlog?: boolean;
}

function addSuggestedTask(
  decider: Decider,
  parent: Task,
  suggestion: TaskSuggestion,
  start: SuggestionStart
) {
  return createTask(decider, {
    type: 'task.create',
    request: suggestion.request,
    repoId: parent.repoId,
    priority: parent.priority,
    origin: parent.origin,
    waitsOn: start.waitsOnThis ? [parent.id] : [],
    ...(start.stackOnThis ? { stacksOn: [parent.id] } : {}),
    ...(start.backlog ? { backlog: true } : {}),
  });
}

function settle(
  decider: Decider,
  taskId: string,
  suggestionId: string,
  createdTaskId: string | null,
  autopilot: string | null
) {
  decider.emit({
    type: 'suggestion.settled',
    taskId,
    suggestionId,
    status: createdTaskId === null ? 'dismissed' : 'accepted',
    createdTaskId,
    ...(autopilot === null ? {} : { autopilot }),
  });
}

export function acceptSuggestion(decider: Decider, command: CommandOf<'suggestion.accept'>) {
  const suggestion = findOpenSuggestion(decider, command.taskId, command.suggestionId);
  assertOneStart(command);
  const parent = decider.task(command.taskId);
  const createdTaskId = addSuggestedTask(decider, parent, suggestion, {
    waitsOnThis: command.waitsOnThis,
    stackOnThis: command.stackOnThis,
    backlog: command.backlog,
  });
  recordDecisions(decider, [
    { task: parent, gate: null, kind: 'suggestion', answer: 'accepted', note: suggestion.title },
  ]);
  settle(decider, parent.id, suggestion.id, createdTaskId, null);
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
  settle(decider, command.taskId, suggestion.id, null, null);
}

export function settleSuggestionForYou(
  decider: Decider,
  parent: Task,
  suggestion: TaskSuggestion,
  accept: boolean,
  reason: string
) {
  const createdTaskId = accept
    ? addSuggestedTask(decider, parent, suggestion, { waitsOnThis: suggestion.waitsOnThis })
    : null;
  settle(decider, parent.id, suggestion.id, createdTaskId, reason);
}
