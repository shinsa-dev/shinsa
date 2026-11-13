import { Option } from 'effect';
import { isAgentQuestion, isDecisionGate } from '../domain/gates.ts';
import { resolveTaskRounds, type Round } from '../domain/rounds.ts';
import type { Task, TimingSpan, YourInput } from '../domain/types.ts';
import { resolveTaskTiming } from '../state/timing.ts';
import type { StatsSource } from './index.ts';
import {
  listSetAside,
  measureOnYourClock,
  resolveYourClock,
  type YourActivity,
  type YourClock,
} from './presence.ts';
import { clipSpans, mergeSpans, subtractSpans } from './spans.ts';
import {
  type FinishedRound,
  listFinishedRounds,
  listPaused,
  measureRound,
  resolveRoundEnd,
  toMedian,
  type TurnaroundMedian,
  type TurnaroundWindow,
} from './turnaround.ts';

export interface TasksAtOnce {
  median: number | null;
  peak: number | null;
}

export interface FirstTimeApprovals {
  share: number | null;
  count: number;
}

export interface YourAttention {
  tasksAtOnce: TasksAtOnce;
  rounds: number;
  inputsPerRound: TurnaroundMedian;
  agentTimePerInput: TurnaroundMedian;
  handsOffShare: number | null;
  questionShare: number | null;
  messagesPerRound: number | null;
  approvedFirstTime: FirstTimeApprovals;
}

interface Concurrency {
  count: number;
  weight: number;
}

const GOING_ROUNDS: readonly Round['status'][] = ['active', 'shipped'];

function resolveGoingEnd(task: Task, round: Round, now: number) {
  if (round.endedAt !== null) return round.endedAt;
  return GOING_ROUNDS.includes(round.status) ? now : resolveRoundEnd(task, round);
}

export function listGoingSpans(task: Task, clock: YourClock, window: TurnaroundWindow): TimingSpan[] {
  const range = { from: window.from, to: window.now };
  const rounds = resolveTaskRounds(task).flatMap((round) =>
    round.startedAt === null ? [] : [{ from: round.startedAt, to: resolveGoingEnd(task, round, window.now) }]
  );
  const cuts = [...listPaused(task, window.now), ...listSetAside(clock, task, window.now)];
  return mergeSpans(clipSpans(rounds, range)).flatMap((span) => subtractSpans(span, cuts));
}

function listConcurrency(source: StatsSource, clock: YourClock, window: TurnaroundWindow): Concurrency[] {
  const changes = new Map<number, number>();
  for (const task of Object.values(source.tasks)) {
    for (const span of listGoingSpans(task, clock, window)) {
      changes.set(span.from, (changes.get(span.from) ?? 0) + 1);
      changes.set(span.to, (changes.get(span.to) ?? 0) - 1);
    }
  }
  const times = [...changes.keys()].sort((a, b) => a - b);
  const segments: Concurrency[] = [];
  let count = 0;
  for (const [index, from] of times.entries()) {
    count += changes.get(from) ?? 0;
    const to = times[index + 1];
    if (to === undefined || count === 0) continue;
    segments.push({ count, weight: measureOnYourClock(clock, { from, to }) });
  }
  return segments;
}

export function resolveWeightedMedian(segments: readonly Concurrency[]): Option.Option<number> {
  const total = segments.reduce((sum, segment) => sum + segment.weight, 0);
  if (total === 0) return Option.none();
  const sorted = [...segments].sort((a, b) => a.count - b.count);
  let running = 0;
  const middle = sorted.find((segment) => {
    running += segment.weight;
    return running >= total / 2;
  });
  return Option.map(Option.fromNullishOr(middle), (segment) => segment.count);
}

function resolveTasksAtOnce(segments: readonly Concurrency[]): TasksAtOnce {
  return {
    median: Option.getOrNull(resolveWeightedMedian(segments)),
    peak: segments.length === 0 ? null : Math.max(...segments.map((segment) => segment.count)),
  };
}

export function listRoundInputs({ task, span }: FinishedRound): YourInput[] {
  return resolveTaskTiming(task).inputs.filter((input) => input.at > span.from && input.at <= span.to);
}

export function isHandsOff(inputs: readonly YourInput[]) {
  return inputs.every(
    (input) => input.kind === 'gate' && isDecisionGate({ type: input.gate }) && input.decision === 'approve'
  );
}

function hasQuestion(inputs: readonly YourInput[]) {
  return inputs.some((input) => input.kind === 'gate' && isAgentQuestion({ type: input.gate }));
}

function countMessages(inputs: readonly YourInput[]) {
  return inputs.filter((input) => input.kind === 'message').length;
}

export function resolveFirstReview(inputs: readonly YourInput[]) {
  const review = inputs.find((input) => input.kind === 'gate' && input.gate === 'review');
  return review?.kind === 'gate' ? Option.some(review.decision) : Option.none();
}

function resolveShare(matching: number, count: number) {
  return count === 0 ? null : matching / count;
}

function resolveApprovedFirstTime(rounds: readonly YourInput[][]): FirstTimeApprovals {
  const reviews = rounds.flatMap((inputs) => Option.toArray(resolveFirstReview(inputs)));
  const approved = reviews.filter((decision) => decision === 'approve').length;
  return { share: resolveShare(approved, reviews.length), count: reviews.length };
}

export function resolveAttention(
  source: StatsSource,
  you: YourActivity,
  window: TurnaroundWindow
): YourAttention {
  const clock = resolveYourClock(you, window.now, window.hourOf);
  const rounds = listFinishedRounds(source, window).map((round) => ({
    inputs: listRoundInputs(round),
    agent: measureRound(round, clock, window.now).agent,
  }));
  const inputs = rounds.map((round) => round.inputs);
  const count = rounds.length;
  const messages = inputs.reduce((total, round) => total + countMessages(round), 0);
  return {
    tasksAtOnce: resolveTasksAtOnce(listConcurrency(source, clock, window)),
    rounds: count,
    inputsPerRound: toMedian(inputs.map((round) => round.length)),
    agentTimePerInput: toMedian(rounds.map((round) => round.agent / Math.max(1, round.inputs.length))),
    handsOffShare: resolveShare(inputs.filter(isHandsOff).length, count),
    questionShare: resolveShare(inputs.filter(hasQuestion).length, count),
    messagesPerRound: count === 0 ? null : messages / count,
    approvedFirstTime: resolveApprovedFirstTime(inputs),
  };
}
