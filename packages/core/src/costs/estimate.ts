import { Option } from 'effect';
import { CLAUDE_PROVIDER } from '../agent-models/index.ts';
import type { Run, Task } from '../domain/index.ts';
import { isOfCurrentRound } from '../domain/rounds.ts';
import type { ShinsaState } from '../state/project.ts';
import { createPercent, createUsd } from './amounts.ts';
import { resolveMeterWindow, resolveUsageRates, type UsageRate } from './rate.ts';
import type { Percent, Usd } from './schema.ts';

export const BUILD_ESTIMATE_LIMITS = {
  quantile: 0.7,
  minSamples: 20,
  ridge: 2,
  priorPhases: 1,
} as const;

export const DEFAULT_BUILD_COSTS = {
  measuredOn: '2026-11-08',
  builds: 303,
  usdPerPhase: [3.8, 3.8, 7.4, 12.9, 17.6, 20],
} as const;

export interface BuildEstimate {
  phases: number;
  donePhases: number;
  usd: Usd;
  spentUsd: Usd;
  remainingUsd: Usd;
  percent: Option.Option<Percent>;
  remainingPercent: Option.Option<Percent>;
  samples: number;
  trusted: boolean;
}

interface BuildShape {
  phases: number;
  files: number;
  text: number;
  planUsd: number;
}

interface BuildSample extends BuildShape {
  usd: number;
}

interface BuildModel {
  weights: number[];
  offset: number;
  samples: number;
}

type EstimateState = Pick<ShinsaState, 'tasks' | 'runs' | 'accountPlans'>;

const MODELS = new WeakMap<Record<string, Task>, WeakMap<Record<string, Run>, BuildModel | null>>();
const SETTLED_PHASES = new Set(['done', 'skipped']);

function resolvePlanUsd(runs: Record<string, Run>, task: Task) {
  return Object.values(runs)
    .filter((run) => run.taskId === task.id && run.purpose === 'plan' && isOfCurrentRound(task, run))
    .reduce((sum, run) => sum + (run.usage?.costUsd ?? 0), 0);
}

function resolveBuildShape(runs: Record<string, Run>, task: Task): BuildShape | null {
  const document = task.plan?.document;
  if (!document || document.phases.length === 0 || task.phases.length === 0) return null;
  return {
    phases: document.phases.length,
    files: document.files.length,
    text: JSON.stringify(document).length,
    planUsd: resolvePlanUsd(runs, task),
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
  const shape = resolveBuildShape(runs, task);
  if (!shape || countDonePhases(task) < task.phases.length) return null;
  const built = listBuildRuns(runs, task).filter((run) => run.usage);
  if (built.some((run) => run.usage?.costUsd === null)) return null;
  const usd = resolveSpentUsd(built);
  return usd > 0 ? { ...shape, usd } : null;
}

function resolveFeatures(shape: BuildShape) {
  return [1, shape.phases, shape.files, shape.text, shape.planUsd].map((value, index) =>
    index === 0 ? value : Math.log(value + 1)
  );
}

function solveLinear(matrix: number[][], vector: number[]) {
  const size = vector.length;
  const rows = matrix.map((row, index) => [...row, vector[index] as number]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row]?.[column] as number) > Math.abs(rows[pivot]?.[column] as number)) pivot = row;
    }
    [rows[column], rows[pivot]] = [rows[pivot] as number[], rows[column] as number[]];
    const lead = rows[column] as number[];
    for (let row = 0; row < size; row += 1) {
      const current = rows[row] as number[];
      const factor = row === column ? 0 : (current[column] as number) / (lead[column] as number);
      for (let index = column; index <= size; index += 1) {
        current[index] = (current[index] as number) - factor * (lead[index] as number);
      }
    }
  }
  return rows.map((row, index) => (row[size] as number) / (row[index] as number));
}

function resolveQuantile(values: number[], quantile: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)] as number;
}

function resolvePrediction(weights: number[], features: number[]) {
  return features.reduce((sum, value, index) => sum + value * (weights[index] as number), 0);
}

function fitBuildModel(samples: BuildSample[]): BuildModel | null {
  if (samples.length < BUILD_ESTIMATE_LIMITS.minSamples) return null;
  const rows = samples.map(resolveFeatures);
  const targets = samples.map((sample) => Math.log(sample.usd));
  const size = rows[0]?.length as number;
  const gram = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_unused, column) =>
      rows.reduce(
        (sum, features) => sum + (features[row] as number) * (features[column] as number),
        row === column && row > 0 ? BUILD_ESTIMATE_LIMITS.ridge / rows.length : 0
      )
    )
  );
  const moment = Array.from({ length: size }, (_, row) =>
    rows.reduce((sum, features, index) => sum + (features[row] as number) * (targets[index] as number), 0)
  );
  const weights = solveLinear(gram, moment);
  const residuals = rows.map(
    (features, index) => (targets[index] as number) - resolvePrediction(weights, features)
  );
  return {
    weights,
    offset: resolveQuantile(residuals, BUILD_ESTIMATE_LIMITS.quantile),
    samples: samples.length,
  };
}

function resolveBuildModel(state: EstimateState) {
  const byRuns = MODELS.get(state.tasks) ?? new WeakMap<Record<string, Run>, BuildModel | null>();
  MODELS.set(state.tasks, byRuns);
  if (byRuns.has(state.runs)) return byRuns.get(state.runs) ?? null;
  const samples = Object.values(state.tasks)
    .map((task) => resolveSample(state.runs, task))
    .filter((sample) => sample !== null);
  const model = fitBuildModel(samples);
  byRuns.set(state.runs, model);
  return model;
}

function resolveDefaultPerPhase(phases: number) {
  const table = DEFAULT_BUILD_COSTS.usdPerPhase;
  return table[Math.min(phases, table.length) - 1] as number;
}

function resolvePriorPerPhase(model: BuildModel | null, shape: BuildShape) {
  if (!model) return { perPhase: resolveDefaultPerPhase(shape.phases), samples: 0 };
  const usd = Math.exp(resolvePrediction(model.weights, resolveFeatures(shape)) + model.offset);
  return { perPhase: usd / shape.phases, samples: model.samples };
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

export function resolveBuildEstimate(state: EstimateState, task: Task): Option.Option<BuildEstimate> {
  const shape = resolveBuildShape(state.runs, task);
  if (!shape) return Option.none();
  const prior = resolvePriorPerPhase(resolveBuildModel(state), shape);
  const done = countDonePhases(task);
  const spentUsd = resolveSpentUsd(listBuildRuns(state.runs, task));
  const remainingUsd = resolveRemainingUsd(prior.perPhase, shape, done, spentUsd);
  const rate = resolveEstimateRate(state, task);
  const percentOf = (usd: number) =>
    Option.map(Option.fromNullishOr(rate), (found) => createPercent(usd * found.percentPerUsd));
  return Option.some({
    phases: shape.phases,
    donePhases: done,
    usd: createUsd(spentUsd + remainingUsd),
    spentUsd: createUsd(spentUsd),
    remainingUsd: createUsd(remainingUsd),
    percent: percentOf(spentUsd + remainingUsd),
    remainingPercent: percentOf(remainingUsd),
    samples: prior.samples,
    trusted: rate?.trusted ?? false,
  });
}
