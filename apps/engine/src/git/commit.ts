import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runCommand, runCommandOrThrow } from '../shell/index.ts';
import { assertRefName } from './refs.ts';
import { runGitOrThrow } from './run.ts';

async function resolveGitPath(path: string, name: string) {
  return resolve(path, await runCommandOrThrow(['git', 'rev-parse', '--git-path', name], path));
}

function resolveMergeHeadPath(path: string) {
  return resolveGitPath(path, 'MERGE_HEAD');
}

async function readMergeHead(path: string) {
  const file = await resolveMergeHeadPath(path);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

async function resolveMergeMessage(path: string, fallback: string) {
  const file = await resolveGitPath(path, 'MERGE_MSG');
  const subject = existsSync(file) ? (readFileSync(file, 'utf8').split('\n')[0]?.trim() ?? '') : '';
  if (!subject) return fallback;
  return subject.replace(/^Merge remote-tracking branch '[^/']+\/([^']+)'/, "Merge branch '$1'");
}

interface PendingMerge {
  mergeHead: string;
  mergeMessage: string;
}

export async function writeMergeHead(path: string, merge: PendingMerge) {
  writeFileSync(await resolveMergeHeadPath(path), merge.mergeHead);
  writeFileSync(await resolveGitPath(path, 'MERGE_MSG'), `${merge.mergeMessage}\n`);
}

async function assertMergeResolved(path: string) {
  const unmerged = await runCommandOrThrow(['git', 'diff', '--name-only', '--diff-filter=U'], path);
  if (!unmerged) return;
  throw new Error(
    `The merge still has conflicts in ${unmerged.split('\n').join(', ')}. Resolve them and \`git add\` the files, then hand over again.`
  );
}

export async function commitWorktree(path: string, message: string) {
  const mergeHead = await readMergeHead(path);
  const status = await runCommandOrThrow(['git', 'status', '--porcelain'], path);
  if (status.length === 0 && mergeHead === null) return null;
  if (mergeHead !== null) await assertMergeResolved(path);
  await runGitOrThrow(['add', '-A'], path);
  let merge: PendingMerge | null = null;
  if (mergeHead !== null) merge = { mergeHead, mergeMessage: await resolveMergeMessage(path, message) };
  await runGitOrThrow(['commit', '--no-verify', '-q', '-F', '-'], path, {
    input: merge?.mergeMessage ?? message,
  });
  return { merge };
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
    { timeoutMs: null, signal }
  );
}

export function resolveHead(path: string) {
  return runCommandOrThrow(['git', 'rev-parse', 'HEAD'], path);
}

export function resolveTree(path: string) {
  return runCommandOrThrow(['git', 'rev-parse', 'HEAD^{tree}'], path);
}
