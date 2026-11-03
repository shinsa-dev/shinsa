import { resolveTaskRounds, type Round } from '../domain/rounds.ts';
import type { Task, TimingSpan } from '../domain/types.ts';
import { resolveTaskTiming } from '../state/timing.ts';
import type { StatsSource, StatsWindow } from './index.ts';
import {
  type HourOfWeek,
  listSetAside,
  measureOnYourClock,
  resolveYourClock,
  type YourActivity,
  type YourClock,
} from './presence.ts';
import { clipSpans, subtractSpans, sumSpans } from './spans.ts';

export interface TurnaroundWindow extends StatsWindow {
  from: number;
  hourOf: HourOfWeek;
  now: number;
}

export interface FinishedRound {
  task: Task;
  round: Round;
  span: TimingSpan;
}

export interface TurnaroundMedian {
  median: number | null;
  count: number;
}

export interface Turnaround {
  startToFinish: TurnaroundMedian;
  agentTime: TurnaroundMedian;
  yourTurnaround: TurnaroundMedian;
  waitingShare: number | null;
}

export interface RoundTime {
  agent: number;
  yours: number;
}

const FINISHED_ROUNDS: readonly Round['status'][] = ['merged', 'finished'];

export function resolveMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function toMedian(values: readonly number[]): TurnaroundMedian {
  return { median: resolveMedian(values), count: values.length };
}

export function listPaused(task: Task, now: number): TimingSpan[] {
  const timing = resolveTaskTiming(task);
  const open = timing.pausedSince === null ? [] : [{ from: timing.pausedSince, to: now }];
  return [...timing.paused, ...open];
}

function listNeedsYou(task: Task, now: number): TimingSpan[] {
  const timing = resolveTaskTiming(task);
  const open = timing.needsYouSince === null ? [] : [{ from: timing.needsYouSince, to: now }];
  return [...timing.needsYou, ...open];
}

export function resolveRoundEnd(task: Task, round: Round) {
  return round.endedAt ?? task.closedAt ?? task.stageChangedAt;
}

function measureYours(clock: YourClock, spans: readonly TimingSpan[]) {
  return spans.reduce((total, span) => total + measureOnYourClock(clock, span), 0);
}

export function measureRound({ task, span }: FinishedRound, clock: YourClock, now: number): RoundTime {
  const paused = clipSpans(listPaused(task, now), span);
  const active = subtractSpans(span, paused);
  const waits = clipSpans(listNeedsYou(task, now), span).flatMap((wait) => subtractSpans(wait, paused));
  const setAside = listSetAside(clock, task, now);
  return {
    agent: sumSpans(active) - sumSpans(waits),
    yours: measureYours(
      clock,
      waits.flatMap((wait) => subtractSpans(wait, setAside))
    ),
  };
}

export function listFinishedRounds(source: StatsSource, window: TurnaroundWindow) {
  const days = new Set(window.days);
  const rounds: FinishedRound[] = [];
  for (const task of Object.values(source.tasks)) {
    for (const round of resolveTaskRounds(task)) {
      if (!FINISHED_ROUNDS.includes(round.status) || round.startedAt === null) continue;
      const span = { from: round.startedAt, to: resolveRoundEnd(task, round) };
      if (days.has(window.dayOf(span.to))) rounds.push({ task, round, span });
    }
  }
  return rounds;
}

function listWaitTimes(source: StatsSource, clock: YourClock, window: TurnaroundWindow) {
  const days = new Set(window.days);
  const times: number[] = [];
  for (const task of Object.values(source.tasks)) {
    const cuts = [...listPaused(task, window.now), ...listSetAside(clock, task, window.now)];
    for (const wait of resolveTaskTiming(task).needsYou) {
      if (!wait.answered || !days.has(window.dayOf(wait.to))) continue;
      times.push(measureYours(clock, subtractSpans(wait, cuts)));
    }
  }
  return times;
}

export function resolveTurnaround(
  source: StatsSource,
  you: YourActivity,
  window: TurnaroundWindow
): Turnaround {
  const clock = resolveYourClock(you, window.now, window.hourOf);
  const rounds = listFinishedRounds(source, window).map((round) => measureRound(round, clock, window.now));
  const counted = rounds.reduce((total, round) => total + round.agent + round.yours, 0);
  const yours = rounds.reduce((total, round) => total + round.yours, 0);
  return {
    startToFinish: toMedian(rounds.map((round) => round.agent + round.yours)),
    agentTime: toMedian(rounds.map((round) => round.agent)),
    yourTurnaround: toMedian(listWaitTimes(source, clock, window)),
    waitingShare: counted === 0 ? null : yours / counted,
  };
}
