import { addUsage, resolveUsageDelta } from '../costs/index.ts';
import { resolveTaskRounds } from '../domain/rounds.ts';
import type { PullRequestChanges, Run, RunRole, RunUsage, Task } from '../domain/types.ts';
import type { ShinsaState } from '../state/project.ts';

export interface TokenLine {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  tokens: number;
  knownUsd: number;
}

export interface StatsDay {
  day: string;
  pullRequests: number;
  tasks: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  usage: TokenLine;
}

export interface StatsBreakdown<Key extends string> {
  key: Key;
  usage: TokenLine;
}

export type StatsWork = NonNullable<Run['purpose']> | RunRole;

export interface TaskTokens {
  taskId: string;
  title: string;
  handle: string | null;
  usage: TokenLine;
  cacheHitRate: number | null;
}

export interface StatsStreak {
  current: number;
  longest: number;
}

export interface Stats {
  days: StatsDay[];
  total: StatsDay;
  streak: StatsStreak;
  cacheHitRate: number | null;
  byRole: StatsBreakdown<RunRole>[];
  byWork: StatsBreakdown<StatsWork>[];
  byModel: StatsBreakdown<string>[];
  tasks: TaskTokens[];
}

export interface StatsWindow {
  days: readonly string[];
  dayOf: (at: number) => string;
}

export const UNKNOWN_MODEL = 'unknown';

const SHIPPED_STAGES: readonly Task['stage'][] = ['merged', 'done'];

type DayLookup = (at: number) => StatsDay | null;

interface UsageSlice {
  at: number;
  usage: RunUsage;
}

function createTokenLine(): TokenLine {
  return {
    runs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    tokens: 0,
    knownUsd: 0,
  };
}

function createDay(day: string): StatsDay {
  return {
    day,
    pullRequests: 0,
    tasks: 0,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    usage: createTokenLine(),
  };
}

function addTokens(line: TokenLine, usage: RunUsage, runs: number): TokenLine {
  return {
    runs: line.runs + runs,
    inputTokens: line.inputTokens + usage.inputTokens,
    outputTokens: line.outputTokens + usage.outputTokens,
    cacheReadTokens: line.cacheReadTokens + usage.cacheReadTokens,
    cacheWriteTokens: line.cacheWriteTokens + usage.cacheWriteTokens,
    tokens:
      line.tokens + usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
    knownUsd: line.knownUsd + (usage.costUsd ?? 0),
  };
}

export function sumTokenLines(lines: TokenLine[]) {
  return lines.reduce(
    (total, line) => ({
      runs: total.runs + line.runs,
      inputTokens: total.inputTokens + line.inputTokens,
      outputTokens: total.outputTokens + line.outputTokens,
      cacheReadTokens: total.cacheReadTokens + line.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + line.cacheWriteTokens,
      tokens: total.tokens + line.tokens,
      knownUsd: total.knownUsd + line.knownUsd,
    }),
    createTokenLine()
  );
}

function resolvePromptTokens(line: TokenLine) {
  return line.inputTokens + line.cacheReadTokens + line.cacheWriteTokens;
}

export function resolveCacheHitRate(line: TokenLine) {
  const prompt = resolvePromptTokens(line);
  return prompt === 0 ? null : line.cacheReadTokens / prompt;
}

export function listUsageSlices(run: Run): UsageSlice[] {
  if (!run.usage) return [];
  const meters = run.meters ?? [];
  const slices = meters.map((meter) => ({ at: meter.to, usage: meter.usage }));
  const metered = meters.reduce<RunUsage | null>((total, meter) => addUsage(total, meter.usage), null);
  const rest = resolveUsageDelta(metered, run.usage);
  const restTokens = rest.inputTokens + rest.outputTokens + rest.cacheReadTokens + rest.cacheWriteTokens;
  if (restTokens > 0) slices.push({ at: run.endedAt ?? run.startedAt, usage: rest });
  return slices;
}

function resolveWorkKey(run: Run): StatsWork {
  return run.purpose ?? run.role;
}

function resolveMergedAt(task: Task, endedAt: number | null) {
  return endedAt ?? task.closedAt ?? task.stageChangedAt;
}

function listMergedPullRequests(task: Task) {
  const merged = new Map<number, { at: number; changes: PullRequestChanges | null }>();
  for (const round of resolveTaskRounds(task)) {
    const pullRequest = round.pullRequest;
    if (round.status !== 'merged' || !pullRequest) continue;
    const at = resolveMergedAt(task, round.endedAt);
    const previous = merged.get(pullRequest.number);
    if (previous && previous.at > at) continue;
    merged.set(pullRequest.number, { at, changes: pullRequest.changes ?? null });
  }
  return [...merged.values()];
}

function resolveStreak(days: StatsDay[]): StatsStreak {
  let longest = 0;
  let run = 0;
  let before = 0;
  for (const day of days) {
    before = run;
    run = day.pullRequests > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return { current: run > 0 ? run : before, longest };
}

function listBreakdown<Key extends string>(lines: Map<Key, TokenLine>): StatsBreakdown<Key>[] {
  return [...lines.entries()]
    .map(([key, usage]) => ({ key, usage }))
    .sort((a, b) => b.usage.tokens - a.usage.tokens || a.key.localeCompare(b.key));
}

function addToMap<Key>(lines: Map<Key, TokenLine>, key: Key, usage: RunUsage, runs: number) {
  lines.set(key, addTokens(lines.get(key) ?? createTokenLine(), usage, runs));
}

interface UsageFold {
  byRole: Map<RunRole, TokenLine>;
  byWork: Map<StatsWork, TokenLine>;
  byModel: Map<string, TokenLine>;
  byTask: Map<string, TokenLine>;
}

function foldRunUsage(fold: UsageFold, run: Run, dayAt: DayLookup) {
  let counted = false;
  for (const slice of listUsageSlices(run)) {
    const day = dayAt(slice.at);
    if (!day) continue;
    const runs = counted ? 0 : 1;
    counted = true;
    day.usage = addTokens(day.usage, slice.usage, runs);
    addToMap(fold.byRole, run.role, slice.usage, runs);
    addToMap(fold.byWork, resolveWorkKey(run), slice.usage, runs);
    addToMap(fold.byModel, run.model ?? UNKNOWN_MODEL, slice.usage, runs);
    addToMap(fold.byTask, run.taskId, slice.usage, runs);
  }
}

function foldShipping(task: Task, dayAt: DayLookup) {
  if (SHIPPED_STAGES.includes(task.stage)) {
    const day = dayAt(task.closedAt ?? task.stageChangedAt);
    if (day) day.tasks += 1;
  }
  for (const merged of listMergedPullRequests(task)) {
    const day = dayAt(merged.at);
    if (!day) continue;
    day.pullRequests += 1;
    day.additions += merged.changes?.additions ?? 0;
    day.deletions += merged.changes?.deletions ?? 0;
    day.changedFiles += merged.changes?.changedFiles ?? 0;
  }
}

function listTaskTokens(state: Pick<ShinsaState, 'tasks'>, fold: UsageFold): TaskTokens[] {
  return [...fold.byTask.entries()]
    .map(([taskId, usage]): TaskTokens => {
      const task = state.tasks[taskId];
      return {
        taskId,
        title: task?.title ?? taskId,
        handle: task?.handle ?? null,
        usage,
        cacheHitRate: resolveCacheHitRate(usage),
      };
    })
    .sort((a, b) => b.usage.tokens - a.usage.tokens || a.taskId.localeCompare(b.taskId));
}

function resolveTotal(series: StatsDay[]): StatsDay {
  const total = createDay('');
  for (const day of series) {
    total.pullRequests += day.pullRequests;
    total.tasks += day.tasks;
    total.additions += day.additions;
    total.deletions += day.deletions;
    total.changedFiles += day.changedFiles;
  }
  total.usage = sumTokenLines(series.map((day) => day.usage));
  return total;
}

export function resolveStats(state: Pick<ShinsaState, 'tasks' | 'runs'>, window: StatsWindow): Stats {
  const days = new Map(window.days.map((day) => [day, createDay(day)]));
  const dayAt: DayLookup = (at) => days.get(window.dayOf(at)) ?? null;
  const fold: UsageFold = {
    byRole: new Map(),
    byWork: new Map(),
    byModel: new Map(),
    byTask: new Map(),
  };
  for (const run of Object.values(state.runs)) foldRunUsage(fold, run, dayAt);
  for (const task of Object.values(state.tasks)) foldShipping(task, dayAt);
  const series = [...days.values()];
  const total = resolveTotal(series);
  return {
    days: series,
    total,
    streak: resolveStreak(series),
    cacheHitRate: resolveCacheHitRate(total.usage),
    byRole: listBreakdown(fold.byRole),
    byWork: listBreakdown(fold.byWork),
    byModel: listBreakdown(fold.byModel),
    tasks: listTaskTokens(state, fold),
  };
}
