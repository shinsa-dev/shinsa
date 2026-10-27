import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChangedLines,
  COVERAGE_LIMITS,
  type Coverage,
  type CoverageDetection,
  type CoverageSetting,
  mapChangedLines,
  measureCoverage,
  parseChangedLines,
  parseCoverageReport,
  type Repo,
  resolveCustomFormat,
  resolveRepoCoverage,
  type Task,
} from '@shinsa/core';
import { CHECK_ENV, CHECK_TIMEOUT_MS } from '../checks/index.ts';
import { readChangedLinesPatch, readCommitLinesPatch } from '../git/diff.ts';
import { resolveTaskRefs } from '../git/task-refs.ts';
import { describeError } from '../log/index.ts';
import { runCommand } from '../shell/index.ts';
import type { LedgerStore } from '../workspaces/ledger.ts';
import { type CoveragePlan, resolveCoveragePlan, resolveGoModule } from './detect.ts';

export interface CoverageRequest {
  repo: Repo;
  task: Task;
  ledgers: LedgerStore;
  baseBranch: string | null;
  signal: AbortSignal;
  timeoutMs?: number;
}

type PlanChoice = { plan: CoveragePlan } | { refusal: string; command: string } | null;

const DISPLAY_DIR = '<report folder>';

function resolveUnavailable(command: string, reason: string): Coverage {
  return { status: 'unavailable', command, reason: reason.slice(0, COVERAGE_LIMITS.reason) };
}

function resolvePlanChoice(setting: CoverageSetting, worktree: string, dir: string): PlanChoice {
  if (setting.mode === 'off') return null;
  if (setting.mode === 'auto') {
    const plan = resolveCoveragePlan(worktree, dir);
    return plan ? { plan } : null;
  }
  const format = resolveCustomFormat(setting);
  if (!format) {
    return {
      command: setting.command,
      refusal: `Shinsa cannot tell the format of ${setting.report} from its name.`,
    };
  }
  return {
    plan: { tool: 'custom', command: setting.command, report: join(worktree, setting.report), format },
  };
}

function listRoots(worktree: string) {
  const real = realpathSync(worktree);
  return real === worktree ? [worktree] : [worktree, real];
}

function mergeChangedLines(into: ChangedLines, from: ChangedLines) {
  for (const [path, lines] of from) into.set(path, [...(into.get(path) ?? []), ...lines]);
  return into;
}

interface ChangeRange {
  base: string;
  head: string;
}

async function readBranchChangedLines(request: CoverageRequest, worktree: string, range: ChangeRange) {
  const { signal } = request;
  const committed = parseChangedLines(
    await readCommitLinesPatch(request.repo.path, range.base, range.head, signal)
  );
  if (committed.size === 0) return committed;
  const drift = await readChangedLinesPatch(worktree, range.head, signal, [...committed.keys()]);
  return mapChangedLines(committed, drift);
}

async function readOwnedChangedLines(request: CoverageRequest, worktree: string, range: ChangeRange) {
  const changed = await readBranchChangedLines(request, worktree, range);
  const owned = [...request.ledgers.listOwned(request.repo.id, request.task.id)];
  if (owned.length === 0) return changed;
  const uncommitted = await readChangedLinesPatch(worktree, 'HEAD', request.signal, owned);
  return mergeChangedLines(changed, parseChangedLines(uncommitted));
}

async function readTaskChangedLines(request: CoverageRequest, worktree: string, range: ChangeRange) {
  if (request.task.workspace === 'gitbutler') return readOwnedChangedLines(request, worktree, range);
  return parseChangedLines(await readChangedLinesPatch(worktree, range.base, request.signal));
}

async function measurePlan(request: CoverageRequest, worktree: string, plan: CoveragePlan) {
  const { signal } = request;
  const timeoutMs = request.timeoutMs ?? CHECK_TIMEOUT_MS;
  rmSync(plan.report, { force: true });
  const result = await runCommand(['sh', '-c', plan.command], worktree, {
    env: CHECK_ENV,
    timeoutMs,
    signal,
  });
  if (signal.aborted) return null;
  if (result.timedOut) {
    return resolveUnavailable(plan.command, 'It ran too long and was stopped.');
  }
  if (!existsSync(plan.report)) {
    return resolveUnavailable(plan.command, `It wrote no report at ${plan.report} (exit ${result.code}).`);
  }
  const hits = parseCoverageReport(plan.format, readFileSync(plan.report, 'utf8'));
  if (hits.size === 0)
    return resolveUnavailable(plan.command, `The report at ${plan.report} lists no files.`);
  const refs = await resolveTaskRefs(request.repo, request.task, request.baseBranch, signal);
  if (!refs.base) {
    return resolveUnavailable(
      plan.command,
      'Shinsa could not find the commit the task’s branch started from.'
    );
  }
  const changed = await readTaskChangedLines(request, worktree, { base: refs.base, head: refs.head });
  return measureCoverage({
    command: plan.command,
    changed,
    hits,
    roots: listRoots(worktree),
    modulePath: resolveGoModule(worktree),
  });
}

export async function measureTaskCoverage(request: CoverageRequest): Promise<Coverage | null> {
  const worktree = request.task.worktreePath;
  if (!worktree || request.signal.aborted) return null;
  const dir = mkdtempSync(join(tmpdir(), 'shinsa-coverage-'));
  try {
    const choice = resolvePlanChoice(resolveRepoCoverage(request.repo), worktree, dir);
    if (!choice) return null;
    if ('refusal' in choice) return resolveUnavailable(choice.command, choice.refusal);
    try {
      return await measurePlan(request, worktree, choice.plan);
    } catch (error) {
      return resolveUnavailable(choice.plan.command, describeError(error));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function resolveCoverageDetection(path: string): CoverageDetection | null {
  const plan = resolveCoveragePlan(path, DISPLAY_DIR);
  return plan ? { tool: plan.tool, command: plan.command } : null;
}

export function listCoverageDetections(repos: readonly Pick<Repo, 'id' | 'path'>[]) {
  const detected: Record<string, CoverageDetection | null> = {};
  for (const repo of repos) detected[repo.id] = resolveCoverageDetection(repo.path);
  return detected;
}
