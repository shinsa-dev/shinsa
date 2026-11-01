import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { type CheckToRun, describeCount, type ReportCheck } from '@shinsa/core';
import { type CommandResult, runCommand } from '../shell/index.ts';
import { type CheckFailure, describeFailureDiff, type FailureDiff, listCheckFailures } from './failures.ts';
import {
  type FailedTestGroup,
  isCoverageFloorOnly,
  isRerunPassed,
  listFailedTests,
  resolveRerunCommand,
} from './reruns.ts';

export const CHECK_TIMEOUT_MS = 15 * 60 * 1000;

const OUTPUT_TAIL = 4000;

const SIGNAL = /(error|fail|✗|expected|received|panic|exception|\(fail\))/i;

const SIGNAL_LINES = 60;

const CHECK_ENV = { CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' };

const LOW_PRIORITY = ['nice', '-n', '10'];

const COVERAGE_FLOOR_ONLY =
  'Every test passed. Only the coverage floor failed, which a scoped run cannot meet: CI checks it on the whole suite.';

const NO_TESTS =
  /did not match any test files|had no matches|No test files found|No tests found|no tests ran|no test files/i;

const PACKAGE_MANAGERS: { lockfiles: string[]; install: string[] | null }[] = [
  { lockfiles: ['bun.lock', 'bun.lockb'], install: ['bun', 'install'] },
  { lockfiles: ['pnpm-lock.yaml'], install: ['pnpm', 'install', '--frozen-lockfile'] },
  { lockfiles: ['yarn.lock'], install: null },
  { lockfiles: ['package-lock.json'], install: ['npm', 'ci'] },
];

export function resolveInstallCommand(path: string) {
  const managers = PACKAGE_MANAGERS.filter((manager) =>
    manager.lockfiles.some((file) => existsSync(join(path, file)))
  );
  return managers.find((manager) => manager.install)?.install ?? null;
}

export function tailOutput(text: string) {
  const trimmed = text.trim();
  if (trimmed.length <= OUTPUT_TAIL) return trimmed;
  const signal = trimmed
    .split('\n')
    .filter((line) => SIGNAL.test(line))
    .slice(0, SIGNAL_LINES)
    .join('\n');
  const tail = trimmed.slice(-Math.max(1000, OUTPUT_TAIL - signal.length));
  return signal ? `${signal}\n…\n${tail}` : `…\n${tail}`;
}

export interface CheckRun {
  check: ReportCheck;
  output: string;
  timedOut: boolean;
  failedFiles: string[] | null;
  failures: CheckFailure[] | null;
}

export interface CheckOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  env?: Record<string, string>;
  onSpawn?: (pid: number) => void;
}

export type BaseComparison = (run: CheckRun) => Promise<FailureDiff | null>;

export interface CheckRoundOptions extends CheckOptions {
  compare?: BaseComparison;
}

export function runCheckCommand(argv: string[], cwd: string, options: CheckOptions) {
  const prefix = Bun.which('nice') ? LOW_PRIORITY : [];
  return runCommand([...prefix, ...argv], cwd, { ...options, env: { ...CHECK_ENV, ...options.env } });
}

function joinOutput(result: CommandResult) {
  return [result.stdout, result.stderr].filter((part) => part.length > 0).join('\n');
}

function describeFailedRun(result: CommandResult, output: string, timeoutMs: number) {
  const stopped = result.timedOut ? `Stopped after ${Math.round(timeoutMs / 60_000)} minutes.\n` : '';
  return `${stopped}${tailOutput(output)}`.trim() || `exit ${result.code}`;
}

function listGroupPaths(groups: readonly FailedTestGroup[], cwd: string) {
  return groups.flatMap((group) => group.files.map((file) => relative(cwd, join(group.packageDir, file))));
}

export function listFailedFiles(output: string, cwd: string) {
  const failed = listFailedTests(output, cwd);
  return failed.kind === 'files' ? listGroupPaths(failed.groups, cwd) : null;
}

export async function runCheck(check: CheckToRun, cwd: string, options: CheckOptions): Promise<CheckRun> {
  const result = await runCheckCommand(['sh', '-c', check.command], cwd, options);
  const output = joinOutput(result);
  const { id, label, command } = check;
  const floorOnly = !result.ok && !result.timedOut && isCoverageFloorOnly(output);
  if (result.ok || floorOnly) {
    return {
      check: { id, label, command, outcome: 'pass', detail: floorOnly ? COVERAGE_FLOOR_ONLY : null },
      output,
      timedOut: false,
      failedFiles: [],
      failures: [],
    };
  }
  return {
    check: {
      id,
      label,
      command,
      outcome: 'fail',
      detail: describeFailedRun(result, output, options.timeoutMs),
    },
    output,
    timedOut: result.timedOut,
    failedFiles: result.timedOut ? null : listFailedFiles(output, cwd),
    failures: result.timedOut ? null : listCheckFailures(output, cwd),
  };
}

interface GroupRerun {
  group: FailedTestGroup;
  passed: boolean;
  output: string;
}

async function rerunGroups(groups: readonly FailedTestGroup[], cwd: string, options: CheckOptions) {
  const commands = groups.map((group) => ({ group, argv: resolveRerunCommand(group, cwd) }));
  const reruns: GroupRerun[] = [];
  for (const { group, argv } of commands) {
    if (!argv) return null;
    const result = await runCheckCommand(argv, group.packageDir, options);
    if (options.signal?.aborted) return null;
    const output = joinOutput(result);
    reruns.push({ group, passed: isRerunPassed(group.runner, output, result.ok), output });
  }
  return reruns;
}

function describeRerunOutput(reruns: readonly GroupRerun[]) {
  return reruns.map((rerun) => rerun.output).join('\n');
}

function listRerunPaths(reruns: readonly GroupRerun[], cwd: string) {
  return listGroupPaths(
    reruns.map((rerun) => rerun.group),
    cwd
  );
}

export async function confirmFailure(run: CheckRun, cwd: string, options: CheckOptions): Promise<CheckRun> {
  if (run.check.outcome !== 'fail' || run.timedOut) return run;
  const failed = listFailedTests(run.output, cwd);
  if (failed.kind !== 'files') return run;
  const reruns = await rerunGroups(failed.groups, cwd, options);
  if (!reruns) return run;
  const output = `${run.output}\n\nRe-run alone:\n${describeRerunOutput(reruns)}`;
  const failing = reruns.filter((rerun) => !rerun.passed);
  const passing = listRerunPaths(
    reruns.filter((rerun) => rerun.passed),
    cwd
  );
  if (failing.length === 0) {
    const files = describeCount(passing.length, 'test file');
    const detail = `${files} failed in the full run and passed when re-run alone: ${passing.join(', ')}.`;
    return { ...run, check: { ...run.check, outcome: 'pass', detail, note: 'passed_alone' }, output };
  }
  const failedFiles = listRerunPaths(failing, cwd);
  const lines = [
    `Failed again when re-run alone: ${failedFiles.join(', ')}.`,
    passing.length > 0 ? `Passed when re-run alone: ${passing.join(', ')}.` : '',
    tailOutput(describeRerunOutput(failing)),
  ];
  const detail = lines.filter((line) => line.length > 0).join('\n');
  const failures =
    run.failures?.filter((failure) => failure.kind !== 'test' || failedFiles.includes(failure.file)) ?? null;
  return { ...run, check: { ...run.check, detail }, output, failedFiles, failures };
}

async function compareOnBase(run: CheckRun, options: CheckRoundOptions): Promise<CheckRun> {
  if (run.check.outcome !== 'fail' || run.timedOut || !options.compare || options.signal?.aborted) return run;
  if (NO_TESTS.test(run.output)) return run;
  const diff = await options.compare(run);
  if (!diff) return run;
  const detail = [describeFailureDiff(diff), run.check.detail].filter(Boolean).join('\n\n');
  if (diff.added.length > 0) return { ...run, check: { ...run.check, detail } };
  return { ...run, check: { ...run.check, detail, note: 'fails_on_base' } };
}

async function runConfirmedCheck(check: CheckToRun, cwd: string, options: CheckRoundOptions) {
  const run = await confirmFailure(await runCheck(check, cwd, options), cwd, options);
  return compareOnBase(run, options);
}

export function runChecks(checks: readonly CheckToRun[], cwd: string, options: CheckRoundOptions) {
  const byCommand = new Map<string, Promise<CheckRun>>();
  return Promise.all(
    checks.map(async (check) => {
      const pending = byCommand.get(check.command) ?? runConfirmedCheck(check, cwd, options);
      byCommand.set(check.command, pending);
      const run = await pending;
      const { id, label } = check;
      return { ...run, check: { ...run.check, id, label } };
    })
  );
}
