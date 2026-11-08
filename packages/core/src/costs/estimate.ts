import { CLAUDE_PROVIDER } from '../agent-models/index.ts';
import type { Run, Task } from '../domain/index.ts';
import { isOfCurrentRound } from '../domain/rounds.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveMeterWindow, resolveUsageRates, type UsageRate } from './rate.ts';

export const BUILD_ESTIMATE_LIMITS = {
  neighbours: 20,
  quantile: 0.7,
  minSamples: 3,
  priorPhases: 1,
  checksWeight: 0.5,
} as const;

export const DEFAULT_BUILD_COSTS = {
  measuredOn: '2026-11-08',
  builds: 303,
  usdPerPhase: [3.8, 3.8, 7.4, 12.9, 17.6, 20],
} as const;

export interface BuildEstimate {
  phases: number;
  donePhases: number;
  usd: number;
  spentUsd: number;
  remainingUsd: number;
  percent: number | null;
  remainingPercent: number | null;
  samples: number;
  trusted: boolean;
}

interface BuildShape {
  phases: number;
  files: number;
  checks: number;
}

interface BuildSample extends BuildShape {
  taskId: string;
  usdPerPhase: number;
}

type EstimateState = Pick<ShinsaState, 'tasks' | 'runs' | 'accountPlans'>;

const SAMPLES = new WeakMap<Record<string, Task>, WeakMap<Record<string, Run>, BuildSample[]>>();
const SETTLED_PHASES = new Set(['done', 'skipped']);

function resolveBuildShape(task: Task): BuildShape | null {
  const document = task.plan?.document;
  if (!document || document.phases.length === 0 || task.phases.length === 0) return null;
  return {
    phases: document.phases.length,
    files: document.files.length,
    checks: document.verification.length,
  };
}

function isBuildRun(run: Run) {
  return run.purpose === 'build' || run.purpose === 'fix' || run.role === 'reviewer';
}

function listBuildRuns(runs: Record<string, Run>, task: Task) {
  return Object.values(runs).filter(
    (run) => run.taskId === task.id && isBuildRun(run) && isOfCurrentRound(task, run)
  );
}

function countDonePhases(task: Task) {
  return task.phases.filter((phase) => SETTLED_PHASES.has(phase.status)).length;
}

function resolveSpentUsd(runs: Run[]) {
  return runs.reduce((sum, run) => sum + (run.usage?.costUsd ?? 0), 0);
}

function resolveSample(runs: Record<string, Run>, task: Task): BuildSample | null {
  const shape = resolveBuildShape(task);
  if (!shape || countDonePhases(task) < task.phases.length) return null;
  const built = listBuildRuns(runs, task).filter((run) => run.usage);
  if (built.some((run) => run.usage?.costUsd === null)) return null;
  const usd = resolveSpentUsd(built);
  return usd > 0 ? { ...shape, taskId: task.id, usdPerPhase: usd / shape.phases } : null;
}

function listBuildSamples(state: EstimateState) {
  const byRuns = SAMPLES.get(state.tasks) ?? new WeakMap<Record<string, Run>, BuildSample[]>();
  SAMPLES.set(state.tasks, byRuns);
  const known = byRuns.get(state.runs);
  if (known) return known;
  const samples = Object.values(state.tasks)
    .map((task) => resolveSample(state.runs, task))
    .filter((sample) => sample !== null);
  byRuns.set(state.runs, samples);
  return samples;
}

function resolveLogDistance(a: number, b: number) {
  return Math.abs(Math.log((a + 1) / (b + 1)));
}

function resolveDistance(shape: BuildShape, sample: BuildSample) {
  return (
    resolveLogDistance(shape.phases, sample.phases) +
    resolveLogDistance(shape.files, sample.files) +
    BUILD_ESTIMATE_LIMITS.checksWeight * resolveLogDistance(shape.checks, sample.checks)
  );
}

function resolveQuantile(values: number[], quantile: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)] as number;
}

function resolveDefaultPerPhase(phases: number) {
  const table = DEFAULT_BUILD_COSTS.usdPerPhase;
  return table[Math.min(phases, table.length) - 1] as number;
}

function resolvePriorPerPhase(samples: BuildSample[], shape: BuildShape) {
  if (samples.length < BUILD_ESTIMATE_LIMITS.minSamples) {
    return { perPhase: resolveDefaultPerPhase(shape.phases), samples: 0 };
  }
  const nearest = samples
    .map((sample) => ({ sample, distance: resolveDistance(shape, sample) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, BUILD_ESTIMATE_LIMITS.neighbours)
    .map(({ sample }) => sample.usdPerPhase);
  return { perPhase: resolveQuantile(nearest, BUILD_ESTIMATE_LIMITS.quantile), samples: nearest.length };
}

function isBetterRate(rate: UsageRate, best: UsageRate) {
  return rate.trusted === best.trusted ? rate.tasks > best.tasks : rate.trusted;
}

function selectBestRate(rates: Map<string, UsageRate | null>) {
  let best: UsageRate | null = null;
  for (const rate of rates.values()) {
    if (rate && (!best || isBetterRate(rate, best))) best = rate;
  }
  return best;
}

function resolveTaskWindow(runs: Run[], task: Task) {
  if (task.account) return resolveMeterWindow({ account: task.account, provider: CLAUDE_PROVIDER });
  const metered = runs.filter((run) => (run.meters ?? []).length > 0);
  return (
    metered
      .sort((a, b) => a.startedAt - b.startedAt)
      .at(-1)
      ?.meters?.at(-1)?.window ?? null
  );
}

function resolveEstimateRate(state: EstimateState, task: Task) {
  const rates = resolveUsageRates(state.runs, state.accountPlans);
  const runs = Object.values(state.runs).filter((run) => run.taskId === task.id);
  const window = resolveTaskWindow(runs, task);
  return (window ? rates.get(window) : null) ?? selectBestRate(rates);
}

function resolveRemainingUsd(perPhase: number, shape: BuildShape, done: number, spent: number) {
  if (done === 0) return Math.max(0, perPhase * shape.phases - spent);
  const prior = BUILD_ESTIMATE_LIMITS.priorPhases;
  const corrected = (perPhase * prior + spent) / (prior + done);
  return (shape.phases - done) * corrected;
}

export function resolveBuildEstimate(state: EstimateState, task: Task): BuildEstimate | null {
  const shape = resolveBuildShape(task);
  if (!shape) return null;
  const samples = listBuildSamples(state).filter((sample) => sample.taskId !== task.id);
  const prior = resolvePriorPerPhase(samples, shape);
  const done = countDonePhases(task);
  const spentUsd = resolveSpentUsd(listBuildRuns(state.runs, task));
  const remainingUsd = resolveRemainingUsd(prior.perPhase, shape, done, spentUsd);
  const rate = resolveEstimateRate(state, task);
  const percentOf = (usd: number) => (rate ? usd * rate.percentPerUsd : null);
  return {
    phases: shape.phases,
    donePhases: done,
    usd: spentUsd + remainingUsd,
    spentUsd,
    remainingUsd,
    percent: percentOf(spentUsd + remainingUsd),
    remainingPercent: percentOf(remainingUsd),
    samples: prior.samples,
    trusted: rate?.trusted ?? false,
  };
}
