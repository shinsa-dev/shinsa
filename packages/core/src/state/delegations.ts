import {
  type DeliveryCohort,
  isDelegatedRun,
  type Run,
  type RunDelegation,
  type Task,
} from '../domain/index.ts';
import type { DelegationEventBody } from '../events/delegations.ts';
import type { EventOf } from '../events/index.ts';
import type { ShinsaState } from './project.ts';
import { record, updateRun, updateTask } from './write.ts';

export type DelegatedRun = Run & { delegation: RunDelegation };

export type DeliveryItem =
  | { kind: 'result'; runId: string }
  | { kind: 'question'; runId: string; questionId: string }
  | { kind: 'message'; messageId: string };

const ROLE_NAME: Record<Run['role'], string> = {
  agent: 'agent',
  planner: 'planner',
  builder: 'builder',
  reviewer: 'reviewer',
  answerer: 'answerer',
  investigator: 'investigator',
  researcher: 'researcher',
};

function createCohort(): DeliveryCohort {
  return { nextGeneration: 1, claim: null, deferred: false, messages: [] };
}

export function resolveCohort(run: Run): DeliveryCohort {
  return run.cohort ?? createCohort();
}

function serializeDeliveryItem(item: DeliveryItem) {
  switch (item.kind) {
    case 'result':
      return `result:${item.runId}`;
    case 'question':
      return `question:${item.runId}:${item.questionId}`;
    case 'message':
      return `message:${item.messageId}`;
  }
}

export function parseDeliveryItem(item: string): DeliveryItem | null {
  const [kind, first, second] = item.split(':');
  if (kind === 'result' && first) return { kind, runId: first };
  if (kind === 'question' && first && second) return { kind, runId: first, questionId: second };
  if (kind === 'message' && first) return { kind, messageId: first };
  return null;
}

export function listChildRuns(state: ShinsaState, runId: string): DelegatedRun[] {
  return Object.values(state.runs)
    .filter((run): run is DelegatedRun => isDelegatedRun(run) && run.delegation.parentRunId === runId)
    .sort((a, b) => a.startedAt - b.startedAt);
}

export function listLiveChildRuns(state: ShinsaState, runId: string) {
  return listChildRuns(state, runId).filter((run) => run.endedAt === null);
}

export function selectRootRun(state: ShinsaState, run: Run): Run | null {
  const seen = new Set<string>();
  let current: Run | undefined = run;
  while (current && isDelegatedRun(current)) {
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    current = state.runs[current.delegation.parentRunId];
  }
  return current ?? null;
}

export function countLiveUnderRoot(state: ShinsaState, rootRunId: string) {
  return Object.values(state.runs).filter(
    (run) => isDelegatedRun(run) && run.endedAt === null && selectRootRun(state, run)?.id === rootRunId
  ).length;
}

export function listDelegatedRuns(state: ShinsaState, taskId: string): DelegatedRun[] {
  return Object.values(state.runs)
    .filter((run): run is DelegatedRun => isDelegatedRun(run) && run.taskId === taskId)
    .sort((a, b) => a.startedAt - b.startedAt);
}

function isAwaited(child: DelegatedRun, parent: Run) {
  return child.delegation.wake === 'settled_only' && parent.status !== 'waiting';
}

function listChildItems(child: DelegatedRun, parent: Run): string[] {
  if (isAwaited(child, parent)) return [];
  if (child.endedAt !== null) {
    return child.delegation.delivery === 'none'
      ? [serializeDeliveryItem({ kind: 'result', runId: child.id })]
      : [];
  }
  const question = child.delegation.question;
  if (!question || question.delivered || question.answer !== null) return [];
  return [serializeDeliveryItem({ kind: 'question', runId: child.id, questionId: question.id })];
}

export function listPendingItems(state: ShinsaState, parent: Run) {
  const cohort = resolveCohort(parent);
  const claimed = new Set(cohort.claim?.items ?? []);
  const items = listChildRuns(state, parent.id).flatMap((child) => listChildItems(child, parent));
  const messages =
    parent.status === 'waiting'
      ? cohort.messages.map((message) => serializeDeliveryItem({ kind: 'message', messageId: message.id }))
      : [];
  return [...items, ...messages].filter((item) => !claimed.has(item));
}

export function hasOutstandingDelegations(state: ShinsaState, run: Run) {
  return (
    listLiveChildRuns(state, run.id).length > 0 ||
    resolveCohort(run).messages.length > 0 ||
    listChildRuns(state, run.id).some(
      (child) => child.endedAt !== null && child.delegation.delivery === 'none'
    )
  );
}

export function describeDelegateRole(role: Run['role']) {
  return ROLE_NAME[role];
}

function updateDelegation(state: ShinsaState, runId: string, patch: Partial<RunDelegation>) {
  const run = state.runs[runId];
  if (!run || !isDelegatedRun(run)) return;
  updateRun(state, runId, { delegation: { ...run.delegation, ...patch } });
}

function updateCohort(state: ShinsaState, runId: string, patch: Partial<DeliveryCohort>) {
  const run = state.runs[runId];
  if (!run) return;
  updateRun(state, runId, { cohort: { ...resolveCohort(run), ...patch } });
}

export function applyDelegationStarted(state: ShinsaState, run: Run, at: number) {
  if (!isDelegatedRun(run)) return;
  record(state, run.taskId, at, {
    actor: 'agent',
    kind: 'delegation',
    text: `Delegated “${run.delegation.title}” to a ${describeDelegateRole(run.role)}`,
    detail: run.delegation.brief,
    runId: run.delegation.parentRunId,
  });
}

function applyAcknowledged(state: ShinsaState, runId: string) {
  const run = state.runs[runId];
  if (!run || !isDelegatedRun(run)) return;
  const question = run.delegation.question;
  updateDelegation(state, runId, {
    ...(run.endedAt !== null && run.delegation.delivery === 'none' ? { delivery: 'acknowledged' } : {}),
    ...(question && question.answer === null ? { question: { ...question, delivered: true } } : {}),
  });
}

function selectDelegation(state: ShinsaState, runId: string) {
  const run = state.runs[runId];
  return run && isDelegatedRun(run) ? run.delegation : null;
}

function markResult(state: ShinsaState, runId: string, delivered: boolean) {
  const delegation = selectDelegation(state, runId);
  if (delegation?.delivery !== (delivered ? 'none' : 'delivered')) return;
  updateDelegation(state, runId, { delivery: delivered ? 'delivered' : 'none' });
}

function markQuestion(state: ShinsaState, runId: string, questionId: string, delivered: boolean) {
  const question = selectDelegation(state, runId)?.question;
  if (question?.id !== questionId) return;
  updateDelegation(state, runId, { question: { ...question, delivered } });
}

function markItems(state: ShinsaState, items: string[], delivered: boolean) {
  for (const raw of items) {
    const item = parseDeliveryItem(raw);
    if (item?.kind === 'result') markResult(state, item.runId, delivered);
    if (item?.kind === 'question') markQuestion(state, item.runId, item.questionId, delivered);
  }
}

function applyDelivered(state: ShinsaState, event: EventOf<'delegation.delivered'>) {
  const run = state.runs[event.runId];
  if (!run) return;
  markItems(state, event.items, true);
  const cohort = resolveCohort(run);
  const delivered = new Set(event.items);
  updateRun(state, run.id, {
    cohort: {
      ...cohort,
      claim: null,
      messages: cohort.messages.filter(
        (message) => !delivered.has(serializeDeliveryItem({ kind: 'message', messageId: message.id }))
      ),
      ...(event.via === 'wake' ? { deferred: false } : {}),
    },
    ...(event.via === 'wake' ? { status: 'running' as const, waitingOn: null } : {}),
  });
}

function applyReleased(state: ShinsaState, event: EventOf<'delegation.released'>) {
  const run = state.runs[event.runId];
  if (!run) return;
  markItems(state, event.items, false);
  updateCohort(state, run.id, {
    ...(event.generation === null ? {} : { claim: null }),
    ...(event.deferred ? { deferred: true } : {}),
  });
}

function applyQuestionAsked(state: ShinsaState, event: EventOf<'delegation.asked'>) {
  const run = state.runs[event.runId];
  if (!run || !isDelegatedRun(run)) return;
  updateDelegation(state, run.id, { question: event.question });
  record(state, run.taskId, event.at, {
    actor: 'agent',
    kind: 'delegation',
    text: `“${run.delegation.title}” asked the agent that delegated it: ${event.question.question}`,
    runId: run.id,
  });
}

function applyQuestionAnswered(state: ShinsaState, event: EventOf<'delegation.answered'>) {
  const run = state.runs[event.runId];
  const question = run && isDelegatedRun(run) ? run.delegation.question : null;
  if (!question || question.id !== event.questionId) return;
  updateDelegation(state, event.runId, {
    question: { ...question, delivered: true, answer: event.answer, answeredAt: event.at },
  });
}

function applySplit(state: ShinsaState, event: EventOf<'task.split'>) {
  const task = state.tasks[event.taskId];
  if (!task) return;
  updateTask(state, task.id, event.at, { splits: [...(task.splits ?? []), event.split] });
  const count = event.split.taskIds.length;
  record(state, task.id, event.at, {
    actor: 'agent',
    kind: 'delegation',
    text: `Split the accepted plan into ${count} ${count === 1 ? 'task' : 'tasks'}`,
    runId: event.split.runId,
  });
}

export function resolveLineage(event: EventOf<'task.created'>): Partial<Task> {
  return {
    ...(event.parentTaskId ? { parentTaskId: event.parentTaskId } : {}),
    ...(event.createdBy ? { createdBy: event.createdBy } : {}),
    ...(event.watchHome ? { watchHome: true } : {}),
  };
}

export function recordCourierTask(state: ShinsaState, event: EventOf<'task.created'>) {
  const creator = event.createdBy;
  if (creator?.kind !== 'courier') return;
  record(state, creator.taskId, event.at, {
    actor: 'agent',
    kind: 'delegation',
    text: `Created a task: ${state.tasks[event.taskId]?.title ?? event.request}`,
    detail: event.request,
    runId: creator.runId,
  });
}

export function applyDelegationEvent(
  state: ShinsaState,
  event: DelegationEventBody & { seq: number; at: number }
) {
  switch (event.type) {
    case 'delegation.asked':
      applyQuestionAsked(state, event);
      return;
    case 'delegation.answered':
      applyQuestionAnswered(state, event);
      return;
    case 'delegation.acknowledged':
      applyAcknowledged(state, event.runId);
      return;
    case 'delegation.wake_changed':
      updateDelegation(state, event.runId, { wake: event.wake });
      return;
    case 'delegation.adopted':
      updateDelegation(state, event.runId, { parentRunId: event.parentRunId });
      return;
    case 'delegation.claimed': {
      const run = state.runs[event.runId];
      if (!run) return;
      const cohort = resolveCohort(run);
      updateCohort(state, run.id, {
        claim: event.claim,
        nextGeneration: Math.max(cohort.nextGeneration, event.claim.generation + 1),
      });
      return;
    }
    case 'delegation.delivered':
      applyDelivered(state, event);
      return;
    case 'delegation.released':
      applyReleased(state, event);
      return;
    case 'delegation.message_queued': {
      const run = state.runs[event.runId];
      if (!run) return;
      updateCohort(state, run.id, { messages: [...resolveCohort(run).messages, event.message] });
      return;
    }
    case 'run.waiting':
      updateRun(state, event.runId, { status: 'waiting', waitingOn: event.wait });
      updateCohort(state, event.runId, { deferred: false });
      return;
    case 'task.split':
      applySplit(state, event);
      return;
  }
}
