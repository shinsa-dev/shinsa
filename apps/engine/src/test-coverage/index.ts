import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import {
  COVERAGE_LIMITS,
  type Coverage,
  type CoverageDetection,
  type CoverageHits,
  measureCoverage,
  parseChangedLines,
  parseCoverageReport,
  type Repo,
  resolveCustomFormat,
  resolveRepoCoverage,
  type Task,
} from '@shinsa/core';
import { CHECK_TIMEOUT_MS, runCheckCommand } from '../checks/index.ts';
import { readChangedLinesPatch } from '../git/diff.ts';
import { resolveTaskRefs } from '../git/task-refs.ts';
import { describeError } from '../log/index.ts';
import { type CoverageRun, resolveCoverageDetection, resolveCoverageRun, resolveGoModule } from './detect.ts';

export interface CoverageRequest {
  repo: Repo;
  task: Task;
  commands: readonly string[];
  baseBranch: string | null;
  signal: AbortSignal;
  timeoutMs?: number;
}

type RunChoice = { runs: CoverageRun[] } | { refusal: string; command: string } | null;

function resolveUnavailable(command: string, reason: string): Coverage {
  return {
    status: 'unavailable',
    command: command.slice(0, COVERAGE_LIMITS.command),
    reason: reason.slice(0, COVERAGE_LIMITS.reason),
  };
}

function listTestRuns(commands: readonly string[], worktree: string, dir: string) {
  const runs: CoverageRun[] = [];
  for (const command of new Set(commands)) {
    const run = resolveCoverageRun(command, worktree, join(dir, String(runs.length + 1)));
    if (run) runs.push(run);
  }
  return runs;
}

function resolveRunChoice(request: CoverageRequest, worktree: string, dir: string): RunChoice {
  const setting = resolveRepoCoverage(request.repo);
  if (setting.mode === 'off') return null;
  if (setting.mode === 'auto') {
    const runs = listTestRuns(request.commands, worktree, dir);
    return runs.length > 0 ? { runs } : null;
  }
  const format = resolveCustomFormat(setting);
  if (!format) {
    return {
      command: setting.command,
      refusal: `Shinsa cannot tell the format of ${setting.report} from its name.`,
    };
  }
  const report = join(worktree, setting.report);
  return { runs: [{ tool: 'custom', command: setting.command, cwd: worktree, report, format }] };
}

function listRoots(worktree: string) {
  const real = realpathSync(worktree);
  return real === worktree ? [worktree] : [worktree, real];
}

async function readTaskChangedLines(request: CoverageRequest, worktree: string, base: string) {
  return parseChangedLines(await readChangedLinesPatch(worktree, base, request.signal));
}

function resolveReportKey(path: string, run: CoverageRun) {
  if (run.format === 'go' || isAbsolute(path)) return path;
  return join(run.cwd, path);
}

function mergeHits(into: CoverageHits, run: CoverageRun, hits: CoverageHits) {
  for (const [path, lines] of hits) {
    const key = resolveReportKey(path, run);
    const known = into.get(key) ?? new Map<number, number>();
    for (const [line, count] of lines) known.set(line, (known.get(line) ?? 0) + count);
    into.set(key, known);
  }
}

async function runCoverage(request: CoverageRequest, worktree: string, run: CoverageRun) {
  const timeoutMs = request.timeoutMs ?? CHECK_TIMEOUT_MS;
  rmSync(run.report, { force: true });
  mkdirSync(dirname(run.report), { recursive: true });
  const result = await runCheckCommand(['sh', '-c', run.command], worktree, {
    timeoutMs,
    signal: request.signal,
  });
  if (result.timedOut) return 'It ran too long and was stopped.';
  if (!existsSync(run.report)) return `It wrote no report at ${run.report} (exit ${result.code}).`;
  const hits = parseCoverageReport(run.format, readFileSync(run.report, 'utf8'));
  return hits.size === 0 ? `The report at ${run.report} lists no files.` : hits;
}

async function collectHits(request: CoverageRequest, worktree: string, runs: readonly CoverageRun[]) {
  const hits: CoverageHits = new Map();
  const problems: string[] = [];
  for (const run of runs) {
    if (request.signal.aborted) return null;
    const read = await runCoverage(request, worktree, run);
    if (typeof read === 'string') problems.push(read);
    else mergeHits(hits, run, read);
  }
  return { hits, problems };
}

async function measureRuns(request: CoverageRequest, worktree: string, runs: readonly CoverageRun[]) {
  const { signal } = request;
  const command = runs.map((run) => run.command).join('\n');
  const collected = await collectHits(request, worktree, runs);
  if (!collected || signal.aborted) return null;
  if (collected.hits.size === 0) return resolveUnavailable(command, collected.problems.join(' '));
  const refs = await resolveTaskRefs(request.repo, request.task, request.baseBranch, signal);
  if (!refs.base) {
    return resolveUnavailable(command, 'Shinsa could not find the commit the task’s branch started from.');
  }
  const changed = await readTaskChangedLines(request, worktree, refs.base);
  return measureCoverage({
    command: command.slice(0, COVERAGE_LIMITS.command),
    changed,
    hits: collected.hits,
    roots: listRoots(worktree),
    modulePath: resolveGoModule(worktree),
  });
}

export async function measureTaskCoverage(request: CoverageRequest): Promise<Coverage | null> {
  const worktree = request.task.worktreePath;
  if (!worktree || request.signal.aborted) return null;
  const dir = mkdtempSync(join(tmpdir(), 'shinsa-coverage-'));
  try {
    const choice = resolveRunChoice(request, worktree, dir);
    if (!choice) return null;
    if ('refusal' in choice) return resolveUnavailable(choice.command, choice.refusal);
    try {
      return await measureRuns(request, worktree, choice.runs);
    } catch (error) {
      return resolveUnavailable(choice.runs.map((run) => run.command).join('\n'), describeError(error));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function listCoverageDetections(repos: readonly Pick<Repo, 'id' | 'path'>[]) {
  const detected: Record<string, CoverageDetection | null> = {};
  for (const repo of repos) detected[repo.id] = resolveCoverageDetection(repo.path);
  return detected;
}
