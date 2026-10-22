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

function resolveRunner(path: string) {
  if (existsSync(join(path, 'bun.lock')) || existsSync(join(path, 'bun.lockb'))) return 'bun run';
  if (existsSync(join(path, 'pnpm-lock.yaml'))) return 'pnpm run';
  if (existsSync(join(path, 'yarn.lock'))) return 'yarn';
  return 'npm run';
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
  timeoutMs = CHECK_TIMEOUT_MS
): Promise<ReportCheck> {
  const result = await runCommand(['sh', '-c', command], cwd, { env: CHECK_ENV, timeoutMs });
  if (result.ok) return { name: command, outcome: 'pass', detail: null };
  const output = [result.stdout, result.stderr].filter((part) => part.length > 0).join('\n');
  const stopped = result.timedOut ? `Stopped after ${Math.round(timeoutMs / 60_000)} minutes.\n` : '';
  return {
    name: command,
    outcome: 'fail',
    detail: `${stopped}${tailOutput(output)}`.trim() || `exit ${result.code}`,
  };
}

export async function runChecks(repo: Repo, path: string) {
  const results: ReportCheck[] = [];
  for (const command of resolveCheckCommands(repo, path)) results.push(await runCheck(command, path));
  return results;
}
