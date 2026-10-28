import type { CommandOf } from '../commands/index.ts';
import {
  canChangeRoundShipping,
  DEFAULT_ROUND_SHIPPING,
  DomainError,
  isTaskClosed,
  isTaskResting,
  listQueuedRounds,
  type PullRequest,
  ROUND_LIMITS,
  type Round,
  type RoundShipping,
  resolveCurrentRound,
  resolveNextRoundNumber,
  resolveOperationTiming,
  resolveRoundTitle,
  resolveTaskPipeline,
  resolveTaskRounds,
  SHAPE_PIPELINES,
  selectShippingTarget,
  type Task,
  type TaskShape,
  toRoundPullRequest,
} from '../domain/index.ts';
import type { ShinsaState } from '../state/project.ts';
import { listOpenGates } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { startWork } from './lifecycle.ts';

interface RoundRequest {
  request: string;
  title: string | null;
  why: string | null;
  shape: TaskShape | null;
}

interface RoundBranch {
  branch: string | null;
  base: string | null;
  onto: number | null;
}

const FALLBACK_BRANCH = 'shinsa/task';

function isAtMergeGate(state: ShinsaState, task: Task) {
  return (
    task.stage === 'awaiting_merge' &&
    listOpenGates(state, task.id).some((gate) => gate.type === 'merge') &&
    resolveOperationTiming(resolveTaskPipeline(task)) !== 'post_merge'
  );
}

function isAtRest(state: ShinsaState, task: Task, next: Round) {
  if (isTaskClosed(task)) return false;
  if (isTaskResting(task)) return true;
  return next.pipeline.includes('pull_request') && isAtMergeGate(state, task);
}

export function queueRound(decider: Decider, taskId: string, input: RoundRequest) {
  const task = decider.task(taskId);
  if (listQueuedRounds(task).length >= ROUND_LIMITS.queued) {
    throw new DomainError(
      'rounds_full',
      `This task already has ${ROUND_LIMITS.queued} rounds waiting to start. Let one start first.`
    );
  }
  const number = resolveNextRoundNumber(task);
  decider.emit({
    type: 'round.queued',
    taskId,
    round: {
      number,
      title: input.title?.trim() || resolveRoundTitle(input.request),
      request: input.request,
      why: input.why?.trim() || null,
      shipping: DEFAULT_ROUND_SHIPPING,
      pipeline: [...SHAPE_PIPELINES[input.shape ?? 'change']],
    },
  });
  return number;
}

function resolveNewBranch(task: Task, number: number) {
  const root = resolveTaskRounds(task).find((round) => round.branch)?.branch ?? null;
  if (root) return `${root}-round-${number}`;
  return task.branch ?? task.proposedBranch ?? FALLBACK_BRANCH;
}

function resolveBranch(task: Task, number: number, shipping: RoundShipping, open: Round | null): RoundBranch {
  const pullRequest = open?.pullRequest ?? null;
  if (open && pullRequest && shipping === 'onto_pull_request') {
    return { branch: open.branch, base: open.base, onto: pullRequest.number };
  }
  return {
    branch: resolveNewBranch(task, number),
    base: pullRequest ? (open?.branch ?? null) : null,
    onto: null,
  };
}

function selectOpenRound(task: Task) {
  if (task.pullRequest?.state !== 'open') return null;
  const current = resolveCurrentRound(task);
  return { ...current, branch: task.branch, pullRequest: toRoundPullRequest(task.pullRequest) };
}

function isRidingMergedPullRequest(task: Task, pullRequest: PullRequest) {
  if (pullRequest.state !== 'merged' || task.stage === 'shipping' || task.stage === 'awaiting_merge') {
    return false;
  }
  const current = resolveCurrentRound(task).number;
  return resolveTaskRounds(task).some(
    (round) =>
      round.number < current && round.status === 'shipped' && round.pullRequest?.number === pullRequest.number
  );
}

export function recordEarlierRoundMerged(decider: Decider, task: Task, pullRequest: PullRequest) {
  if (!isRidingMergedPullRequest(task, pullRequest)) return false;
  const number = resolveCurrentRound(task).number;
  decider.emit({
    type: 'round.pull_request_merged',
    taskId: task.id,
    pullRequest: pullRequest.number,
    branch: resolveNewBranch(task, number),
  });
  return true;
}

function startRound(decider: Decider, task: Task, round: Round) {
  decider.withdrawGates(task.id, (gate) => gate.type === 'merge');
  const branch = resolveBranch(task, round.number, round.shipping, selectOpenRound(task));
  decider.emit({ type: 'round.started', taskId: task.id, number: round.number, ...branch });
  decider.requestBriefing(task.id);
  startWork(decider, task.id);
}

export function startQueuedRounds(decider: Decider) {
  for (const task of Object.values(decider.state.tasks)) {
    const [next] = listQueuedRounds(task);
    if (!next || !isAtRest(decider.state, task, next)) continue;
    startRound(decider, task, next);
  }
}

function findChangingRound(task: Task, number: number) {
  const round = resolveTaskRounds(task).find((candidate) => candidate.number === number);
  if (!round) throw new DomainError('round_not_found', `This task has no round ${number}.`);
  if (canChangeRoundShipping(task, round)) return round;
  throw new DomainError(
    'round_shipped',
    `Round ${number} has already gone to its pull request, so how it ships is set. Choose how the next round ships instead.`
  );
}

export function changeRoundShipping(decider: Decider, command: CommandOf<'round.ship'>) {
  const task = decider.task(command.taskId);
  if (isTaskClosed(task)) throw new DomainError('task_settled', 'This task is finished.');
  const round = findChangingRound(task, command.number);
  if (round.shipping === command.shipping) return;
  const base = { type: 'round.shipping_changed' as const, taskId: task.id, number: round.number };
  if (round.status === 'waiting') {
    decider.emit({ ...base, shipping: command.shipping });
    return;
  }
  const target = selectShippingTarget(task, round);
  const open = resolveTaskRounds(task).find(
    (candidate) => candidate.status === 'shipped' && candidate.pullRequest?.number === target?.number
  );
  if (!open) {
    decider.emit({ ...base, shipping: command.shipping });
    return;
  }
  decider.emit({
    ...base,
    shipping: command.shipping,
    ...resolveBranch(task, round.number, command.shipping, open),
  });
}

function findWaitingRound(task: Task, number: number) {
  if (isTaskClosed(task)) throw new DomainError('task_settled', 'This task is finished.');
  const round = resolveTaskRounds(task).find((candidate) => candidate.number === number);
  if (!round) throw new DomainError('round_not_found', `This task has no round ${number}.`);
  if (round.status === 'waiting') return round;
  throw new DomainError(
    'round_started',
    `Round ${number} has already started, so it can no longer be changed or removed. Send a message instead.`
  );
}

export function updateRound(decider: Decider, command: CommandOf<'round.update'>) {
  const task = decider.task(command.taskId);
  const round = findWaitingRound(task, command.number);
  const request = command.request.trim();
  if (request.length === 0) throw new DomainError('message_required', 'Write a message first.');
  if (request === round.request) return;
  decider.emit({
    type: 'round.updated',
    taskId: task.id,
    number: round.number,
    request,
    title: resolveRoundTitle(request),
  });
}

export function removeRound(decider: Decider, command: CommandOf<'round.remove'>) {
  const task = decider.task(command.taskId);
  const round = findWaitingRound(task, command.number);
  decider.emit({ type: 'round.removed', taskId: task.id, number: round.number });
}

export function assertTakesMessages(task: Task) {
  if (isTaskClosed(task)) throw new DomainError('task_settled', 'This task is finished. Start a new one.');
}
