import type { Run, RunAttempt, RunMeter } from '../domain/index.ts';
import { DAY_MS, MINUTE_MS } from '../domain/time.ts';

export const USAGE_RATE_LIMITS = {
  minTasks: 5,
  minMovement: 10,
  halfLifeMs: 7 * DAY_MS,
  idleMs: 2 * MINUTE_MS,
} as const;

interface UsageShare {
  percent: number;
  tasks: number;
  trusted: boolean;
}

export type UsageShareState = UsageShare | 'learning';

export interface UsageRate {
  percentPerUsd: number;
  tasks: number;
  trusted: boolean;
}

interface Span {
  from: number;
  to: number;
  costUsd: number | null;
}

interface Observation {
  taskId: string;
  from: number;
  to: number;
  movement: number;
}

interface Sample {
  taskId: string;
  known: number;
  movement: number;
  costUsd: number;
}

interface WindowLog {
  spans: Span[];
  observations: Observation[];
}

const RATES = new WeakMap<Record<string, Run>, Map<string, UsageRate | null>>();
const SHARES = new WeakMap<Record<string, Run>, Map<string, UsageShareState>>();

export function resolveMeterWindow(attempt: Pick<RunAttempt, 'account' | 'provider'>) {
  return attempt.account ? `account:${attempt.account.id}` : `provider:${attempt.provider}`;
}

function isInFlight(run: Run) {
  return run.endedAt === null && run.status === 'running' && !run.resumePending;
}

function resolveWindowLog(windows: Map<string, WindowLog>, key: string) {
  const log = windows.get(key) ?? { spans: [], observations: [] };
  windows.set(key, log);
  return log;
}

function resolveObservation(taskId: string, meter: RunMeter): Observation | null {
  const readings = [...meter.readings].sort((a, b) => a.at - b.at);
  const first = readings[0];
  const last = readings.at(-1);
  if (!first || !last || last.at <= first.at) return null;
  if (readings.some((reading) => reading.resetsAt !== null && reading.resetsAt <= last.at)) {
    return null;
  }
  const movement = last.percent - first.percent;
  if (movement < 0) return null;
  return { taskId, from: first.at, to: last.at, movement };
}

function collectRun(windows: Map<string, WindowLog>, run: Run) {
  for (const meter of run.meters ?? []) {
    const log = resolveWindowLog(windows, meter.window);
    log.spans.push({ from: meter.from, to: meter.to, costUsd: meter.usage.costUsd });
    const observation = resolveObservation(run.taskId, meter);
    if (observation) log.observations.push(observation);
  }
  const attempt = run.attempts?.at(-1);
  if (!attempt || !isInFlight(run)) return;
  if (run.meters?.some((meter) => meter.attemptId === attempt.attemptId)) return;
  resolveWindowLog(windows, resolveMeterWindow(attempt)).spans.push({
    from: attempt.startedAt,
    to: Number.POSITIVE_INFINITY,
    costUsd: null,
  });
}

function countLeading(length: number, isLeading: (index: number) => boolean) {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (isLeading(middle)) low = middle + 1;
    else high = middle;
  }
  return low;
}

function listOverlapping(spans: Span[], reach: number[], from: number, to: number) {
  const overlapping: Span[] = [];
  let index = countLeading(spans.length, (candidate) => (spans[candidate] as Span).from < to) - 1;
  while (index >= 0 && (reach[index] as number) > from) {
    const span = spans[index] as Span;
    if (span.to > from) overlapping.push(span);
    index -= 1;
  }
  return overlapping.sort((a, b) => a.from - b.from);
}

function resolveCovered(spans: Span[], from: number, to: number) {
  let covered = 0;
  let reached = from;
  for (const span of spans) {
    const start = Math.max(span.from, reached);
    const end = Math.min(span.to, to);
    if (end > start) covered += end - start;
    reached = Math.max(reached, end);
  }
  return covered;
}

function resolveSample(observation: Observation, spans: Span[], reach: number[]): Sample | null {
  const { from, to } = observation;
  const overlapping = listOverlapping(spans, reach, from, to);
  if (overlapping.some((span) => span.costUsd === null)) return null;
  if (to - from - resolveCovered(overlapping, from, to) > USAGE_RATE_LIMITS.idleMs) return null;
  let costUsd = 0;
  for (const span of overlapping) {
    const overlap = Math.min(span.to, to) - Math.max(span.from, from);
    costUsd += ((span.costUsd as number) * overlap) / Math.max(1, span.to - span.from);
  }
  if (costUsd <= 0) return null;
  const known = Math.max(...overlapping.map((span) => span.to));
  return { taskId: observation.taskId, known, movement: observation.movement, costUsd };
}

function listSamples(log: WindowLog) {
  const spans = [...log.spans].sort((a, b) => a.from - b.from);
  const reach: number[] = [];
  for (const [index, span] of spans.entries()) reach.push(Math.max(reach[index - 1] ?? 0, span.to));
  return log.observations
    .map((observation) => resolveSample(observation, spans, reach))
    .filter((sample) => sample !== null)
    .sort((a, b) => a.known - b.known);
}

function resolveRate(samples: Sample[]): UsageRate | null {
  const last = samples.at(-1);
  if (!last) return null;
  const tasks = new Set<string>();
  let movement = 0;
  let decayedMovement = 0;
  let decayedCost = 0;
  for (const sample of samples) {
    const weight = 2 ** (-(last.known - sample.known) / USAGE_RATE_LIMITS.halfLifeMs);
    decayedMovement += sample.movement * weight;
    decayedCost += sample.costUsd * weight;
    movement += sample.movement;
    tasks.add(sample.taskId);
  }
  return {
    percentPerUsd: decayedMovement / decayedCost,
    tasks: tasks.size,
    trusted: tasks.size >= USAGE_RATE_LIMITS.minTasks && movement >= USAGE_RATE_LIMITS.minMovement,
  };
}

function resolveRunShare(run: Run, rates: Map<string, UsageRate | null>): UsageShareState | null {
  if (!run.meters || run.meters.length === 0) return null;
  let percent = 0;
  let tasks = 0;
  let trusted = true;
  for (const meter of run.meters) {
    const rate = rates.get(meter.window);
    if (rate === undefined || meter.usage.costUsd === null) return null;
    if (rate === null) return 'learning';
    percent += meter.usage.costUsd * rate.percentPerUsd;
    tasks = Math.max(tasks, rate.tasks);
    trusted &&= rate.trusted;
  }
  return { percent, tasks, trusted };
}

export function resolveUsageRates(runs: Record<string, Run>): Map<string, UsageRate | null> {
  const known = RATES.get(runs);
  if (known) return known;
  const windows = new Map<string, WindowLog>();
  for (const run of Object.values(runs)) collectRun(windows, run);
  const rates = new Map<string, UsageRate | null>();
  for (const [key, log] of windows) {
    if (log.observations.length > 0) rates.set(key, resolveRate(listSamples(log)));
  }
  RATES.set(runs, rates);
  return rates;
}

export function resolveUsageShares(runs: Record<string, Run>): Map<string, UsageShareState> {
  const known = SHARES.get(runs);
  if (known) return known;
  const rates = resolveUsageRates(runs);
  const shares = new Map<string, UsageShareState>();
  for (const run of Object.values(runs)) {
    const share = resolveRunShare(run, rates);
    if (share) shares.set(run.id, share);
  }
  SHARES.set(runs, shares);
  return shares;
}
