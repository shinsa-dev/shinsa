import { existsSync } from 'node:fs';
import type { ConfigProblem, Repo } from '@shinsa/core';
import { assertRefName } from '../git/index.ts';
import { describeError } from '../log/index.ts';
import { runCommand } from '../shell/index.ts';

export interface SetupScope {
  defaultBranch: boolean;
}

const FETCH_TIMEOUT_MS = 60_000;

async function isGitRepo(path: string) {
  if (!existsSync(path)) return false;
  const result = await runCommand(['git', 'rev-parse', '--is-inside-work-tree'], path);
  return result.ok && result.stdout === 'true';
}

async function hasBranch(path: string, branch: string) {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    const result = await runCommand(['git', 'rev-parse', '--verify', '--quiet', ref], path);
    if (result.ok) return true;
  }
  return false;
}

async function hasDefaultBranch(repo: Repo, branch: string, signal?: AbortSignal) {
  if (await hasBranch(repo.path, branch)) return true;
  if (!repo.remote) return false;
  await runCommand(['git', 'fetch', '--quiet', 'origin', '--', branch], repo.path, {
    timeoutMs: FETCH_TIMEOUT_MS,
    signal,
  });
  return hasBranch(repo.path, branch);
}

async function describeMissingDefaultBranch(repo: Repo, signal?: AbortSignal): Promise<ConfigProblem | null> {
  let branch: string;
  try {
    branch = assertRefName(repo.defaultBranch);
  } catch (error) {
    return { kind: 'default_branch', detail: describeError(error) };
  }
  if (await hasDefaultBranch(repo, branch, signal)) return null;
  return {
    kind: 'default_branch',
    detail: `The default branch “${branch}” is not in the repository${repo.remote ? ' or on origin' : ''}.`,
  };
}

export async function verifySetup(
  repo: Repo,
  scope: SetupScope,
  signal?: AbortSignal
): Promise<ConfigProblem[]> {
  if (!existsSync(repo.path)) {
    return [{ kind: 'repository', detail: `The folder ${repo.path} no longer exists.` }];
  }
  if (!(await isGitRepo(repo.path))) {
    return [{ kind: 'repository', detail: `${repo.path} is not a git repository.` }];
  }
  const problems: ConfigProblem[] = [];
  const branch = scope.defaultBranch && (await describeMissingDefaultBranch(repo, signal));
  if (branch) problems.push(branch);
  return problems;
}
