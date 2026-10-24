import { isTaskSettled } from './stages.ts';
import type { PipelineStep } from './steps.ts';
import type { PullRequest, Task } from './types.ts';

export type RoundShipping = 'onto_pull_request' | 'stacked';

export type RoundStatus = 'waiting' | 'active' | 'shipped' | 'merged' | 'finished' | 'cancelled';

export type MessageKind = 'feedback' | 'acknowledge' | 'new_round' | 'separate_task';

export interface RoundPullRequest {
  number: number;
  url: string;
  state: PullRequest['state'];
  base: string | null;
}

export interface RoundOutcome {
  goal: string | null;
  phases: string[];
  headline: string | null;
  result: string | null;
}

export interface Round {
  number: number;
  title: string;
  request: string;
  why: string | null;
  shipping: RoundShipping;
  status: RoundStatus;
  pipeline: PipelineStep[];
  branch: string | null;
  base: string | null;
  pullRequest: RoundPullRequest | null;
  queuedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  outcome: RoundOutcome | null;
}

export const ROUND_SHIPPINGS: readonly RoundShipping[] = ['onto_pull_request', 'stacked'];

export const MESSAGE_KINDS: readonly MessageKind[] = [
  'feedback',
  'acknowledge',
  'new_round',
  'separate_task',
];

export const ROUND_LIMITS = { title: 80, why: 240, queued: 5 } as const;

export const DEFAULT_ROUND_SHIPPING: RoundShipping = 'onto_pull_request';

type RoundSource = Pick<
  Task,
  'rounds' | 'request' | 'title' | 'createdAt' | 'pipeline' | 'mode' | 'branch' | 'pullRequest' | 'stage'
>;

type ShippingSource = RoundSource & Pick<Task, 'closedAt' | 'fixFor' | 'pushPending'>;

const SHIPPED_STAGES: ReadonlySet<Task['stage']> = new Set<Task['stage']>(['shipping', 'awaiting_merge']);

export function resolveRoundTitle(text: string) {
  return text.trim().split('\n', 1)[0]?.slice(0, ROUND_LIMITS.title) ?? '';
}

function resolveFirstRound(task: RoundSource): Round {
  const settled = isTaskSettled(task);
  return {
    number: 1,
    title: task.title,
    request: task.request,
    why: null,
    shipping: DEFAULT_ROUND_SHIPPING,
    status: settled ? resolveSettledStatus(task.stage) : 'active',
    pipeline: [...(task.pipeline ?? [])],
    branch: task.branch,
    base: null,
    pullRequest: task.pullRequest ? toRoundPullRequest(task.pullRequest) : null,
    queuedAt: task.createdAt,
    startedAt: task.createdAt,
    endedAt: null,
    outcome: null,
  };
}

export function resolveSettledStatus(stage: Task['stage']): RoundStatus {
  if (stage === 'merged') return 'merged';
  return stage === 'cancelled' ? 'cancelled' : 'finished';
}

export function toRoundPullRequest(pullRequest: PullRequest): RoundPullRequest {
  return {
    number: pullRequest.number,
    url: pullRequest.url,
    state: pullRequest.state,
    base: pullRequest.base ?? null,
  };
}

export function resolveTaskRounds(task: RoundSource): readonly Round[] {
  if (task.rounds && task.rounds.length > 0) return task.rounds;
  return [resolveFirstRound(task)];
}

function selectActiveRound(task: RoundSource) {
  return resolveTaskRounds(task).find((round) => round.status === 'active') ?? null;
}

export function resolveCurrentRound(task: RoundSource): Round {
  const rounds = resolveTaskRounds(task);
  const started = rounds.filter((round) => round.startedAt !== null);
  return selectActiveRound(task) ?? started.at(-1) ?? (rounds[0] as Round);
}

export function isLaterRound(task: RoundSource) {
  return resolveCurrentRound(task).number > 1;
}

export function resolveRoundStamp(task: RoundSource): { round?: number } {
  const round = resolveCurrentRound(task).number;
  return round > 1 ? { round } : {};
}

export function isOfCurrentRound(task: RoundSource, item: { round?: number }) {
  return (item.round ?? 1) === resolveCurrentRound(task).number;
}

export function listQueuedRounds(task: RoundSource) {
  return resolveTaskRounds(task).filter((round) => round.status === 'waiting');
}

export function resolveNextRoundNumber(task: RoundSource) {
  return Math.max(...resolveTaskRounds(task).map((round) => round.number)) + 1;
}

export function resolveRoundBase(task: RoundSource) {
  const active = selectActiveRound(task);
  if (!active?.base) return null;
  const stacked = resolveTaskRounds(task).some(
    (round) =>
      round.status === 'shipped' && round.branch === active.base && round.pullRequest?.state === 'open'
  );
  return stacked ? active.base : null;
}

export function listStackedPullRequests(task: RoundSource) {
  const current = task.pullRequest?.number ?? null;
  const seen = new Set<number>(current === null ? [] : [current]);
  const stacked: RoundPullRequest[] = [];
  for (const round of [...resolveTaskRounds(task)].reverse()) {
    const pullRequest = round.pullRequest;
    if (round.status !== 'shipped' || !pullRequest || pullRequest.state !== 'open') continue;
    if (seen.has(pullRequest.number)) continue;
    seen.add(pullRequest.number);
    stacked.push(pullRequest);
  }
  return stacked;
}

export function isTaskClosed(task: Pick<Task, 'closedAt' | 'stage'>) {
  return task.stage === 'cancelled' || (task.closedAt ?? null) !== null;
}

export function isTaskResting(task: Pick<Task, 'closedAt' | 'stage'>) {
  return (task.stage === 'merged' || task.stage === 'done') && !isTaskClosed(task);
}

export function formatRoundLabel(round: Pick<Round, 'number'>) {
  return `round ${round.number}`;
}

export function selectShippingTarget(task: RoundSource, round: Pick<Round, 'number' | 'status'>) {
  if (round.status === 'waiting')
    return task.pullRequest?.state === 'open' ? toRoundPullRequest(task.pullRequest) : null;
  const shipped = resolveTaskRounds(task).filter(
    (candidate) =>
      candidate.number < round.number &&
      candidate.status === 'shipped' &&
      candidate.pullRequest?.state === 'open'
  );
  return shipped.at(-1)?.pullRequest ?? null;
}

export function canChangeRoundShipping(task: ShippingSource, round: Pick<Round, 'status'>) {
  if (isTaskClosed(task)) return false;
  if (round.status === 'waiting') return true;
  return (
    round.status === 'active' &&
    !SHIPPED_STAGES.has(task.stage) &&
    task.fixFor !== 'pull_request' &&
    task.pushPending !== true
  );
}
