import { runCommand, runCommandOrThrow } from '../shell/index.ts';
import { assertRefName } from './refs.ts';
import { runGitOrThrow } from './run.ts';
import { GIT_NETWORK_TIMEOUT_MS } from './worktree.ts';

export async function commitWorktree(path: string, message: string) {
  const status = await runCommandOrThrow(['git', 'status', '--porcelain'], path);
  if (status.length === 0) return false;
  await runGitOrThrow(['add', '-A'], path);
  await runGitOrThrow(['commit', '--no-verify', '-q', '-F', '-'], path, { input: message });
  return true;
}

export async function stashEdits(path: string, message: string) {
  const status = await runCommand(['git', 'status', '--porcelain'], path);
  if (!status.ok || status.stdout.length === 0) return false;
  await runGitOrThrow(['stash', 'push', '--include-untracked', '-m', message], path);
  return true;
}

export async function pushBranch(path: string, branch: string, signal?: AbortSignal) {
  await runCommandOrThrow(
    ['git', 'push', '--quiet', '-u', 'origin', `HEAD:refs/heads/${assertRefName(branch)}`],
    path,
    { timeoutMs: GIT_NETWORK_TIMEOUT_MS, signal }
  );
}

export function resolveHead(path: string) {
  return runCommandOrThrow(['git', 'rev-parse', 'HEAD'], path);
}

export function resolveTree(path: string) {
  return runCommandOrThrow(['git', 'rev-parse', 'HEAD^{tree}'], path);
}
