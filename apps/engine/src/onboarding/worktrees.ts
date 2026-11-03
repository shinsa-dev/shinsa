import { isAbsolute, join, resolve } from 'node:path';
import { DomainError, type OnboardingStatus } from '@shinsa/core';
import type { ServerConfig } from '../config/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { describeWorktreeRootProblem, type WorktreeRoot } from '../workspaces/index.ts';
import { expandHome } from './roots.ts';

const WORKTREES_FOLDER = 'worktrees';

function refuse(message: string): never {
  throw new DomainError({ code: 'worktrees_invalid', message });
}

function describeProblem(path: string) {
  return edgeRuntime.runSync(describeWorktreeRootProblem(path));
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
    problem: resolved.source === 'default' ? null : describeProblem(resolved.path),
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
  const problem = describeProblem(folder);
  if (problem) refuse(problem);
  return folder;
}
