import { existsSync, statfsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { DomainError, type OnboardingStatus, type Task, type WorktreeUsage } from '@shinsa/core';
import { Effect } from 'effect';
import type { WorktreeRoot } from '../workspaces/root/service.ts';
import { expandHome } from './roots.ts';
import {
  type CommandRunner,
  DELEGATIONS_FOLDER,
  KILOBYTE,
  WORKTREE_USAGE_TIMEOUT_MS,
  WORKTREES_FOLDER,
} from './schema.ts';

export const resolveWorktreesStatus = Effect.fn('Onboarding.resolveWorktreesStatus')(function* (
  root: WorktreeRoot['Service'],
  dataDir: string
) {
  const resolved = yield* root.resolve;
  const status: OnboardingStatus['worktrees'] = {
    effective: resolved.path,
    configured: resolved.source === 'config' ? resolved.path : null,
    default: join(dataDir, WORKTREES_FOLDER),
    fromEnvironment: resolved.source === 'environment' ? resolved.path : null,
    problem: null,
  };
  if (resolved.source === 'default') return status;
  return { ...status, problem: yield* root.describeProblem(resolved.path, resolved.source === 'config') };
});

export const resolveChosenWorktreesDir = Effect.fn('Onboarding.resolveChosenWorktreesDir')(function* (
  root: WorktreeRoot['Service'],
  value: unknown,
  userHome: string
) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.trim().length === 0) {
    return yield* new DomainError({
      code: 'worktrees_invalid',
      message: 'Send “path” as the full path of a folder, or null to use the default.',
    });
  }
  const path = expandHome(value.trim(), userHome);
  if (!isAbsolute(path)) {
    return yield* new DomainError({
      code: 'worktrees_invalid',
      message: `${value.trim()} is not a full path.`,
    });
  }
  const folder = resolve(path);
  const problem = yield* root.describeProblem(folder);
  if (problem) return yield* new DomainError({ code: 'worktrees_invalid', message: problem });
  return yield* root
    .mark(folder)
    .pipe(
      Effect.mapError(
        (unavailable) => new DomainError({ code: 'worktrees_invalid', message: unavailable.message })
      )
    );
});

export const measureWorktreeUsage = Effect.fn('Onboarding.measureWorktreeUsage')(function* (
  folder: string,
  tasks: Record<string, Task>,
  run: CommandRunner,
  now: number
) {
  const paths = new Set<string>();
  for (const task of Object.values(tasks)) {
    if (task.worktreePath && task.workspace !== 'main_checkout') paths.add(task.worktreePath);
  }
  const worktrees = yield* Effect.sync(() => [...paths].filter((path) => existsSync(path)));
  const delegations = join(folder, DELEGATIONS_FOLDER);
  const measured = (yield* Effect.sync(() => existsSync(delegations)))
    ? [...worktrees, delegations]
    : worktrees;
  const cwd = (yield* Effect.sync(() => existsSync(folder))) ? folder : '/';
  let bytes: number | null = 0;
  if (measured.length > 0) {
    const result = yield* run(['du', '-sk', '--', ...measured], cwd, {
      timeoutMs: WORKTREE_USAGE_TIMEOUT_MS,
    });
    const kilobytes = result.stdout
      .split('\n')
      .map((line) => Number.parseInt(line, 10))
      .filter((size) => Number.isFinite(size))
      .reduce((total, size) => total + size, 0);
    bytes = result.timedOut || !result.stdout.trim() ? null : kilobytes * KILOBYTE;
  }
  const freeBytes = yield* Effect.try(() => {
    const stats = statfsSync(folder);
    return stats.bavail * stats.bsize;
  }).pipe(Effect.orElseSucceed(() => null));
  const usage: WorktreeUsage = {
    folder,
    worktrees: worktrees.length,
    bytes,
    freeBytes,
    measuredAt: now,
  };
  return usage;
});
