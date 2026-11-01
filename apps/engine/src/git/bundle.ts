import type { BundleConflict, Repo } from '@shinsa/core';
import { describeFailure, runCommand } from '../shell/index.ts';
import { assertRefName } from './refs.ts';
import { runGitOrThrow } from './run.ts';

export interface BundleBranch {
  taskId: string;
  branch: string;
  base: string;
}

const FETCH_TIMEOUT_MS = 2 * 60 * 1000;

const TRIAL_IDENTITY = {
  GIT_AUTHOR_NAME: 'Shinsa',
  GIT_AUTHOR_EMAIL: 'shinsa@localhost',
  GIT_COMMITTER_NAME: 'Shinsa',
  GIT_COMMITTER_EMAIL: 'shinsa@localhost',
};

async function runGit(repo: Repo, args: string[], signal?: AbortSignal) {
  return (await runGitOrThrow(args, repo.path, { signal, env: TRIAL_IDENTITY })).trim();
}

async function syncBundleRefs(repo: Repo, branches: string[], signal?: AbortSignal) {
  const refs = [...new Set(branches)].map((branch) => {
    const name = assertRefName(branch);
    return `+refs/heads/${name}:refs/remotes/origin/${name}`;
  });
  const command = ['git', 'fetch', '--quiet', 'origin', '--', ...refs];
  const result = await runCommand(command, repo.path, { timeoutMs: FETCH_TIMEOUT_MS, signal });
  if (!result.ok) throw new Error(describeFailure(command, result));
}

async function isBehindBase(repo: Repo, member: BundleBranch, signal?: AbortSignal) {
  const command = ['git', 'merge-base', '--is-ancestor', `origin/${member.base}`, `origin/${member.branch}`];
  return !(await runCommand(command, repo.path, { signal })).ok;
}

async function selectBehind(repo: Repo, members: BundleBranch[], signal?: AbortSignal) {
  const behind = await Promise.all(members.map((member) => isBehindBase(repo, member, signal)));
  return members.find((_, index) => behind[index]) ?? null;
}

async function mergeTrial(repo: Repo, onto: string, branch: string, signal?: AbortSignal) {
  const command = ['git', 'merge-tree', '--write-tree', onto, branch];
  const result = await runCommand(command, repo.path, { signal });
  if (result.code === 1) return null;
  if (!result.ok) throw new Error(describeFailure(command, result));
  const tree = result.stdout.trim().split('\n')[0] ?? '';
  return runGit(repo, ['commit-tree', tree, '-p', onto, '-p', branch, '-m', 'Shinsa bundle check'], signal);
}

export async function checkBundleMerge(
  repo: Repo,
  members: BundleBranch[],
  signal?: AbortSignal
): Promise<BundleConflict | null> {
  const target = assertRefName(repo.defaultBranch);
  await syncBundleRefs(repo, [target, ...members.flatMap((member) => [member.base, member.branch])], signal);
  let merged = await runGit(repo, ['rev-parse', `origin/${target}`], signal);
  for (const [index, member] of members.entries()) {
    const next = await mergeTrial(repo, merged, `origin/${member.branch}`, signal);
    if (next === null) {
      const behind = await selectBehind(repo, members.slice(0, index + 1), signal);
      return { taskId: member.taskId, behindTaskId: behind?.taskId ?? null, base: behind?.base ?? target };
    }
    merged = next;
  }
  return null;
}
