import { Option } from 'effect';
import { splitMessageAttachments } from '../chat/attachments.ts';
import { hasMergedPullRequest, isTaskComplete, isTaskSettled } from './stages.ts';
import type { PipelineStep } from './steps.ts';
import type { PullRequest, PullRequestChanges, Task } from './types.ts';

export type RoundShipping = 'onto_pull_request' | 'stacked';

export type RoundStatus = 'waiting' | 'active' | 'shipped' | 'merged' | 'finished' | 'cancelled';

export type MessageKind = 'feedback' | 'acknowledge' | 'new_round' | 'separate_task';

export interface RoundPullRequest {
  number: number;
  url: string;
  state: PullRequest['state'];
  base: string | null;
  changes?: PullRequestChanges | null;
  mergedAt?: number | null;
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
  work?: RoundWork | null;
}

const ROUND_WORK_KEYS = [
  'plan',
  'planHistory',
  'planAnswers',
  'phases',
  'phaseReports',
  'summary',
  'report',
  'reviewSummary',
  'reviewRatings',
  'autopiloted',
  'escalation',
  'findings',
  'reviewDisagreements',
  'reviewedInput',
  'checks',
  'checkResults',
  'coverage',
  'mergeStepsDone',
  'carriedMergeSteps',
] as const satisfies readonly (keyof Task)[];

export type RoundWork = Pick<Task, (typeof ROUND_WORK_KEYS)[number]>;

export function resolveRoundWork(task: Task): RoundWork {
  return Object.fromEntries(ROUND_WORK_KEYS.map((key) => [key, task[key]])) as RoundWork;
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
  | 'rounds'
  | 'request'
  | 'title'
  | 'createdAt'
  | 'pipeline'
  | 'mode'
  | 'branch'
  | 'pullRequest'
  | 'stage'
  | 'stackBases'
>;

type ShippingSource = RoundSource & Pick<Task, 'closedAt' | 'fixFor' | 'pushPending'>;

const SHIPPED_STAGES: ReadonlySet<Task['stage']> = new Set<Task['stage']>(['shipping', 'awaiting_merge']);

export function resolveRoundTitle(text: string) {
  const { text: body, attachments } = splitMessageAttachments(text);
  const line = body.split('\n', 1)[0] || attachments.map((attachment) => attachment.name).join(', ');
  return line.slice(0, ROUND_LIMITS.title);
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
    ...(pullRequest.changes ? { changes: pullRequest.changes } : {}),
    ...(typeof pullRequest.mergedAt === 'number' ? { mergedAt: pullRequest.mergedAt } : {}),
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

export function hasMergedSince(task: RoundSource, round: number) {
  if (hasMergedPullRequest(task)) return true;
  return resolveTaskRounds(task).some((each) => each.number >= round && each.pullRequest?.state === 'merged');
}

export function isDependencyComplete(task: Task, round = resolveCurrentRound(task).number) {
  return isTaskComplete(task) || hasMergedSince(task, round);
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

export function resolveRoundBase(task: RoundSource): Option.Option<string> {
  const active = selectActiveRound(task);
  const stacked = resolveTaskRounds(task).some(
    (round) =>
      round.status === 'shipped' && round.branch === active?.base && round.pullRequest?.state === 'open'
  );
  if (active?.base && stacked) return Option.some(active.base);
  return Option.fromNullishOr(task.stackBases?.[0]);
}

export function resolveRoundBases(task: RoundSource) {
  return Option.match(resolveRoundBase(task), {
    onNone: () => [],
    onSome: (base) => {
      const bases = task.stackBases ?? [];
      return bases[0] === base ? [...bases] : [base];
    },
  });
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
  return `Round ${round.number}`;
}

export function selectShippingTarget(
  task: RoundSource,
  round: Pick<Round, 'number' | 'status'>
): Option.Option<RoundPullRequest> {
  if (round.status === 'waiting')
    return task.pullRequest?.state === 'open'
      ? Option.some(toRoundPullRequest(task.pullRequest))
      : Option.none();
  const shipped = resolveTaskRounds(task).filter(
    (candidate) =>
      candidate.number < round.number &&
      candidate.status === 'shipped' &&
      candidate.pullRequest?.state === 'open'
  );
  return Option.fromNullishOr(shipped.at(-1)?.pullRequest);
}

export function selectEarlierOpenRound(task: RoundSource): Option.Option<Round> {
  const current = resolveCurrentRound(task);
  if (current.status !== 'active') return Option.none();
  const shipped = resolveTaskRounds(task).filter(
    (candidate) =>
      candidate.number < current.number &&
      candidate.status === 'shipped' &&
      candidate.pullRequest?.state === 'open'
  );
  return Option.fromNullishOr(shipped.at(-1));
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
