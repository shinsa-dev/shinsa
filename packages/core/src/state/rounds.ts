import {
  DEFAULT_ROUND_SHIPPING,
  isTaskSettled,
  needsWorktree,
  type PipelineStep,
  type PullRequest,
  type Round,
  type RoundOutcome,
  resolveCurrentRound,
  resolveSettledStatus,
  resolveTaskPipeline,
  resolveTaskRounds,
  type Task,
  type TaskStage,
  toRoundPullRequest,
} from '../domain/index.ts';
import type { EventOf, ShinsaEvent } from '../events/index.ts';
import { listCarriedMergeSteps } from '../report/merge-steps.ts';
import type { ShinsaState } from './project.ts';
import { record, updateTask } from './write.ts';

const RESULT_LIMIT = 4_000;

export function createFirstRound(
  title: string,
  request: string,
  pipeline: PipelineStep[],
  at: number
): Round {
  return {
    number: 1,
    title,
    request,
    why: null,
    shipping: DEFAULT_ROUND_SHIPPING,
    status: 'active',
    pipeline,
    branch: null,
    base: null,
    pullRequest: null,
    queuedAt: at,
    startedAt: at,
    endedAt: null,
    outcome: null,
  };
}

export function resolveRoundOutcome(task: Task): RoundOutcome {
  const document = task.plan?.document ?? null;
  const result = task.result?.body ?? null;
  return {
    goal: document?.goal ?? null,
    phases: (document?.phases ?? []).map((phase) => phase.title),
    headline: task.report?.headline ?? task.summary,
    result: result === null ? null : result.slice(0, RESULT_LIMIT),
  };
}

function writeRounds(state: ShinsaState, task: Task, at: number, rounds: Round[], patch: Partial<Task> = {}) {
  updateTask(state, task.id, at, { rounds, ...patch });
}

function endRound(task: Task, round: Round, status: Round['status'], at: number): Round {
  return {
    ...round,
    status,
    endedAt: at,
    pipeline: [...resolveTaskPipeline(task)],
    branch: round.branch ?? task.branch,
    pullRequest: task.pullRequest ? toRoundPullRequest(task.pullRequest) : round.pullRequest,
    outcome: resolveRoundOutcome(task),
  };
}

function applyRoundQueued(state: ShinsaState, event: EventOf<'round.queued'>) {
  const task = state.tasks[event.taskId];
  if (!task) return;
  const round: Round = {
    ...event.round,
    pipeline: [...event.round.pipeline],
    status: 'waiting',
    branch: null,
    base: null,
    pullRequest: null,
    queuedAt: event.at,
    startedAt: null,
    endedAt: null,
    outcome: null,
  };
  writeRounds(state, task, event.at, [...resolveTaskRounds(task), round]);
  record(state, task.id, event.at, {
    actor: 'you',
    kind: 'round',
    text: `Queued round ${round.number}: ${round.title}`,
    detail: round.why,
  });
}

interface BranchChoice {
  branch: string | null;
  base: string | null;
  onto: number | null;
}

function resolveOntoPullRequest(task: Task, onto: number | null, at: number): PullRequest | null {
  if (onto === null) return null;
  if (task.pullRequest?.number === onto) return task.pullRequest;
  const shipped = resolveTaskRounds(task).find((round) => round.pullRequest?.number === onto)?.pullRequest;
  if (!shipped) return null;
  return {
    number: shipped.number,
    url: shipped.url,
    state: shipped.state,
    ...(shipped.base ? { base: shipped.base } : {}),
    checks: 'pending',
    unresolvedComments: 0,
    mergeable: null,
    updatedAt: at,
  };
}

function resolveBranchPatch(task: Task, choice: BranchChoice, worktree: boolean, at: number): Partial<Task> {
  const pullRequest = resolveOntoPullRequest(task, choice.onto, at);
  const same = pullRequest !== null && pullRequest === task.pullRequest;
  return {
    branch: worktree ? choice.branch : null,
    proposedBranch: worktree ? null : choice.branch,
    pullRequest,
    pullRequestWatch: same ? (task.pullRequestWatch ?? null) : null,
    pullRequestReadFailures: 0,
    pushedSha: same ? (task.pushedSha ?? null) : null,
    pushedFrom: same ? (task.pushedFrom ?? null) : null,
    pushPending: false,
  };
}

function resolveRoundPatch(task: Task, next: Round, choice: BranchChoice, at: number): Partial<Task> {
  return {
    pipeline: [...next.pipeline],
    auto: { ...task.auto, shape: true },
    plan: null,
    planHistory: [],
    planAnswers: null,
    phases: [],
    phaseReports: [],
    summary: null,
    report: null,
    reviewSummary: null,
    findings: [],
    reviewDisagreements: [],
    approveAfterFix: false,
    fixRounds: 0,
    fixFor: null,
    fixSignature: null,
    stalledFixes: 0,
    fixFingerprints: [],
    recoveries: 0,
    checks: [],
    checkResults: null,
    coverage: null,
    result: null,
    proposal: null,
    shapeChanges: [],
    configProblems: [],
    approvedEdits: null,
    pushHookFailure: null,
    mergeStepsDone: [],
    carriedMergeSteps: listCarriedMergeSteps(task),
    ...resolveBranchPatch(task, choice, needsWorktree(next.pipeline), at),
  };
}

function applyRoundStarted(state: ShinsaState, event: EventOf<'round.started'>) {
  const task = state.tasks[event.taskId];
  if (!task) return;
  const rounds = resolveTaskRounds(task);
  const next = rounds.find((round) => round.number === event.number);
  if (!next) return;
  const patch = resolveRoundPatch(task, next, event, event.at);
  const started: Round = {
    ...next,
    status: 'active',
    startedAt: event.at,
    branch: event.branch,
    base: event.base,
    pullRequest: patch.pullRequest ? toRoundPullRequest(patch.pullRequest) : null,
  };
  const updated = rounds.map((round) => {
    if (round.number === event.number) return started;
    return round.status === 'active' ? endRound(task, round, 'shipped', event.at) : round;
  });
  writeRounds(state, task, event.at, updated, patch);
  record(state, task.id, event.at, {
    actor: 'shinsa',
    kind: 'round',
    text: `Started round ${started.number}: ${started.title}`,
    detail: started.request,
  });
}

function applyRoundShippingChanged(state: ShinsaState, event: EventOf<'round.shipping_changed'>) {
  const task = state.tasks[event.taskId];
  if (!task) return;
  const choice =
    event.onto === undefined
      ? null
      : { branch: event.branch ?? null, base: event.base ?? null, onto: event.onto ?? null };
  const patch = choice
    ? resolveBranchPatch(task, choice, needsWorktree(resolveTaskPipeline(task)), event.at)
    : {};
  const rounds = resolveTaskRounds(task).map((round) => {
    if (round.number !== event.number) return round;
    if (!choice) return { ...round, shipping: event.shipping };
    return {
      ...round,
      shipping: event.shipping,
      branch: choice.branch,
      base: choice.base,
      pullRequest: patch.pullRequest ? toRoundPullRequest(patch.pullRequest) : null,
    };
  });
  writeRounds(state, task, event.at, rounds, patch);
  record(state, task.id, event.at, {
    actor: 'you',
    kind: 'round',
    text:
      event.shipping === 'stacked'
        ? `Round ${event.number} ships as its own stacked pull request`
        : `Round ${event.number} ships onto the open pull request`,
  });
}

function applyRoundPullRequestMerged(state: ShinsaState, event: EventOf<'round.pull_request_merged'>) {
  const task = state.tasks[event.taskId];
  if (!task) return;
  const current = resolveCurrentRound(task).number;
  const choice = { branch: event.branch, base: null, onto: null };
  const rounds = resolveTaskRounds(task).map((round): Round => {
    if (round.number === current) return { ...round, branch: event.branch, base: null, pullRequest: null };
    if (round.status !== 'shipped' || round.pullRequest?.number !== event.pullRequest) return round;
    return { ...round, status: 'merged', pullRequest: { ...round.pullRequest, state: 'merged' } };
  });
  const patch = resolveBranchPatch(task, choice, needsWorktree(resolveTaskPipeline(task)), event.at);
  writeRounds(state, task, event.at, rounds, patch);
  record(state, task.id, event.at, {
    actor: 'shinsa',
    kind: 'round',
    text: `Pull request #${event.pullRequest} merged, so round ${current} opens its own pull request`,
  });
}

function resolveSettledRound(task: Task, round: Round, stage: TaskStage, at: number): Round {
  if (round.status === 'active') return endRound(task, round, resolveSettledStatus(stage), at);
  if (round.status === 'shipped' && stage === 'merged') {
    return {
      ...round,
      status: 'merged',
      pullRequest: round.pullRequest ? { ...round.pullRequest, state: 'merged' } : null,
    };
  }
  if ((round.status === 'shipped' && stage === 'cancelled') || round.status === 'waiting') {
    return stage === 'merged' ? round : { ...round, status: 'cancelled', endedAt: at };
  }
  return round;
}

function reopenRound(state: ShinsaState, task: Task, at: number) {
  const rounds = resolveTaskRounds(task);
  if (rounds.some((round) => round.status === 'active')) return;
  const current = resolveCurrentRound(task).number;
  writeRounds(
    state,
    task,
    at,
    rounds.map((round) =>
      round.number === current ? { ...round, status: 'active' as const, endedAt: null, outcome: null } : round
    )
  );
}

export function recordRoundStaged(
  state: ShinsaState,
  taskId: string,
  stage: TaskStage,
  by: 'you' | undefined,
  at: number
) {
  const task = state.tasks[taskId];
  if (!task) return;
  if (!isTaskSettled({ stage })) {
    reopenRound(state, task, at);
    return;
  }
  const closing = stage === 'cancelled' || by === 'you';
  const rounds = resolveTaskRounds(task).map((round) => {
    if (round.status === 'waiting' && !closing) return round;
    return resolveSettledRound(task, round, stage, at);
  });
  writeRounds(state, task, at, rounds, closing ? { closedAt: at } : {});
}

export function recordRoundPullRequest(state: ShinsaState, taskId: string, at: number) {
  const task = state.tasks[taskId];
  const pullRequest = task?.pullRequest;
  if (!task || !pullRequest) return;
  const current = resolveCurrentRound(task).number;
  writeRounds(
    state,
    task,
    at,
    resolveTaskRounds(task).map((round): Round => {
      if (round.number !== current && round.pullRequest?.number !== pullRequest.number) return round;
      const merged = round.status === 'shipped' && pullRequest.state === 'merged';
      return {
        ...round,
        status: merged ? 'merged' : round.status,
        pullRequest: toRoundPullRequest(pullRequest),
      };
    })
  );
}

export function recordRoundPullRequestsClosed(
  state: ShinsaState,
  taskId: string,
  numbers: number[],
  at: number
) {
  const task = state.tasks[taskId];
  if (!task) return;
  writeRounds(
    state,
    task,
    at,
    resolveTaskRounds(task).map((round): Round => {
      const pullRequest = round.pullRequest;
      if (pullRequest?.state !== 'open' || !numbers.includes(pullRequest.number)) return round;
      return { ...round, pullRequest: { ...pullRequest, state: 'closed' } };
    })
  );
}

export function recordRoundBranch(state: ShinsaState, taskId: string, branch: string, at: number) {
  const task = state.tasks[taskId];
  if (!task) return;
  const current = resolveCurrentRound(task).number;
  writeRounds(
    state,
    task,
    at,
    resolveTaskRounds(task).map((round) => (round.number === current ? { ...round, branch } : round))
  );
}

function applyRoundUpdated(state: ShinsaState, event: EventOf<'round.updated'>) {
  const task = state.tasks[event.taskId];
  if (!task) return;
  writeRounds(
    state,
    task,
    event.at,
    resolveTaskRounds(task).map((round) =>
      round.number === event.number ? { ...round, request: event.request, title: event.title } : round
    )
  );
  record(state, task.id, event.at, {
    actor: 'you',
    kind: 'round',
    text: `Changed queued round ${event.number}: ${event.title}`,
    detail: event.request,
  });
}

function applyTaskRetitled(state: ShinsaState, event: EventOf<'task.retitled'>) {
  const task = state.tasks[event.taskId];
  if (!task) return;
  const rounds = resolveTaskRounds(task).map((round) =>
    round.number === event.round ? { ...round, title: event.title } : round
  );
  writeRounds(state, task, event.at, rounds, event.round === 1 ? { title: event.title } : {});
  record(state, task.id, event.at, {
    actor: 'agent',
    kind: 'round',
    text: `Renamed to “${event.title}”`,
  });
}

function applyRoundRemoved(state: ShinsaState, event: EventOf<'round.removed'>) {
  const task = state.tasks[event.taskId];
  const removed = task && resolveTaskRounds(task).find((round) => round.number === event.number);
  if (!task || !removed) return;
  writeRounds(
    state,
    task,
    event.at,
    resolveTaskRounds(task).flatMap((round) => {
      if (round.number === event.number) return [];
      return round.number > event.number ? [{ ...round, number: round.number - 1 }] : [round];
    })
  );
  record(state, task.id, event.at, {
    actor: 'you',
    kind: 'round',
    text: `Removed queued round ${event.number}: ${removed.title}`,
    detail: removed.request,
  });
}

type RoundEvent = Extract<
  ShinsaEvent,
  {
    type:
      | 'round.queued'
      | 'round.started'
      | 'round.shipping_changed'
      | 'round.pull_request_merged'
      | 'round.updated'
      | 'round.removed'
      | 'task.retitled';
  }
>;

export function applyRoundEvent(state: ShinsaState, event: RoundEvent) {
  switch (event.type) {
    case 'round.queued':
      applyRoundQueued(state, event);
      return;
    case 'round.started':
      applyRoundStarted(state, event);
      return;
    case 'round.shipping_changed':
      applyRoundShippingChanged(state, event);
      return;
    case 'round.pull_request_merged':
      applyRoundPullRequestMerged(state, event);
      return;
    case 'round.updated':
      applyRoundUpdated(state, event);
      return;
    case 'round.removed':
      applyRoundRemoved(state, event);
      return;
    case 'task.retitled':
      applyTaskRetitled(state, event);
      return;
  }
}
