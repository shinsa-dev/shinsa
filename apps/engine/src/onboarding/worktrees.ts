import { existsSync, statfsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { DomainError, type OnboardingStatus, type Task, type WorktreeUsage } from '@shinsa/core';
import type { ServerConfig } from '../config/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import {
  describeWorktreeRootMarkProblem,
  describeWorktreeRootProblem,
  type WorktreeRoot,
} from '../workspaces/index.ts';
import { expandHome } from './roots.ts';
import type { CommandRunner } from './schema.ts';

const WORKTREES_FOLDER = 'worktrees';
const DELEGATIONS_FOLDER = 'delegations';
const KILOBYTE = 1024;
export const USAGE_TIMEOUT_MS = 20_000;

function refuse(message: string): never {
  throw new DomainError({ code: 'worktrees_invalid', message });
}

function describeProblem(path: string, chosen = false) {
  return edgeRuntime.runSync(describeWorktreeRootProblem(path, chosen));
}

function mark(path: string) {
  return edgeRuntime.runSync(describeWorktreeRootMarkProblem(path));
}

export function resolveDefaultWorktreesDir(config: ServerConfig) {
  return join(config.dataDir, WORKTREES_FOLDER);
}

export function resolveWorktreesStatus(
  root: WorktreeRoot,
  config: ServerConfig
): OnboardingStatus['worktrees'] {
  const resolved = root.resolve();
  return {
    effective: resolved.path,
    configured: resolved.source === 'config' ? resolved.path : null,
    default: resolveDefaultWorktreesDir(config),
    fromEnvironment: resolved.source === 'environment' ? resolved.path : null,
    problem:
      resolved.source === 'default' ? null : describeProblem(resolved.path, resolved.source === 'config'),
  };
}

export function resolveChosenWorktreesDir(value: unknown, userHome: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.trim().length === 0) {
    refuse('Send “path” as the full path of a folder, or null to use the default.');
  }
  const path = expandHome(value.trim(), userHome);
  if (!isAbsolute(path)) refuse(`${value.trim()} is not a full path.`);
  const folder = resolve(path);
  const problem = describeProblem(folder) ?? mark(folder);
  if (problem) refuse(problem);
  return folder;
}

export function listTaskWorktrees(tasks: Record<string, Task>) {
  const paths = new Set<string>();
  for (const task of Object.values(tasks)) {
    if (task.worktreePath && task.workspace !== 'main_checkout') paths.add(task.worktreePath);
  }
  return [...paths];
}

function readFreeBytes(path: string) {
  try {
    const stats = statfsSync(path);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

function sumKilobytes(stdout: string) {
  let total = 0;
  for (const line of stdout.split('\n')) {
    const size = Number.parseInt(line, 10);
    if (Number.isFinite(size)) total += size;
  }
  return total * KILOBYTE;
}

async function measureBytes(paths: string[], run: CommandRunner, cwd: string) {
  if (paths.length === 0) return 0;
  const result = await run(['du', '-sk', '--', ...paths], cwd, { timeoutMs: USAGE_TIMEOUT_MS });
  if (result.timedOut || !result.stdout.trim()) return null;
  return sumKilobytes(result.stdout);
}

export async function measureWorktreeUsage(
  folder: string,
  tasks: Record<string, Task>,
  run: CommandRunner,
  now: number
): Promise<WorktreeUsage> {
  const worktrees = listTaskWorktrees(tasks).filter((path) => existsSync(path));
  const delegations = join(folder, DELEGATIONS_FOLDER);
  const measured = existsSync(delegations) ? [...worktrees, delegations] : worktrees;
  return {
    folder,
    worktrees: worktrees.length,
    bytes: await measureBytes(measured, run, existsSync(folder) ? folder : '/'),
    freeBytes: readFreeBytes(folder),
    measuredAt: now,
  };
}
