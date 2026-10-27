import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Repo, ReportCheck } from '@shinsa/core';
import { runCommand } from '../shell/index.ts';

const CHECK_TIMEOUT_MS = 15 * 60 * 1000;

const OUTPUT_TAIL = 4000;

const SCRIPT_NAMES = ['lint', 'check-types', 'typecheck', 'test'];

const SIGNAL = /(error|fail|✗|expected|received|panic|exception|\(fail\))/i;

const SIGNAL_LINES = 60;

const CHECK_ENV = { CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' };

const PACKAGE_MANAGERS: { lockfiles: string[]; run: string; install: string[] | null }[] = [
  { lockfiles: ['bun.lock', 'bun.lockb'], run: 'bun run', install: ['bun', 'install'] },
  { lockfiles: ['pnpm-lock.yaml'], run: 'pnpm run', install: ['pnpm', 'install', '--frozen-lockfile'] },
  { lockfiles: ['yarn.lock'], run: 'yarn', install: null },
  { lockfiles: ['package-lock.json'], run: 'npm run', install: ['npm', 'ci'] },
];

function listPackageManagers(path: string) {
  return PACKAGE_MANAGERS.filter((manager) => manager.lockfiles.some((file) => existsSync(join(path, file))));
}

function resolveRunner(path: string) {
  return listPackageManagers(path)[0]?.run ?? 'npm run';
}

export function resolveInstallCommand(path: string) {
  return listPackageManagers(path).find((manager) => manager.install)?.install ?? null;
}

function readScripts(manifest: string) {
  try {
    return (JSON.parse(readFileSync(manifest, 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
  } catch {
    throw new Error(`${manifest} is not valid JSON, so Shinsa cannot find the check scripts.`);
  }
}

export function resolveCheckCommands(repo: Repo, path: string) {
  if (repo.checkCommands.length > 0) return repo.checkCommands;
  const manifest = join(path, 'package.json');
  if (!existsSync(manifest)) return [];
  const scripts = readScripts(manifest);
  const runner = resolveRunner(path);
  return SCRIPT_NAMES.filter((name) => scripts[name]).map((name) => `${runner} ${name}`);
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

export async function runCheck(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ReportCheck> {
  const result = await runCommand(['sh', '-c', command], cwd, { env: CHECK_ENV, timeoutMs, signal });
  if (result.ok) return { name: command, outcome: 'pass', detail: null };
  const output = [result.stdout, result.stderr].filter((part) => part.length > 0).join('\n');
  const stopped = result.timedOut ? `Stopped after ${Math.round(timeoutMs / 60_000)} minutes.\n` : '';
  return {
    name: command,
    outcome: 'fail',
    detail: `${stopped}${tailOutput(output)}`.trim() || `exit ${result.code}`,
  };
}

export async function runChecks(
  repo: Repo,
  path: string,
  planChecks: readonly string[],
  signal?: AbortSignal
) {
  const results: ReportCheck[] = [];
  for (const command of new Set([...resolveCheckCommands(repo, path), ...planChecks])) {
    if (signal?.aborted) break;
    results.push(await runCheck(command, path, CHECK_TIMEOUT_MS, signal));
  }
  return results;
}
