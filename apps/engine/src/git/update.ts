import { describeFailure, runCommand, runCommandOrThrow } from '../shell/index.ts';
import { createPushError } from './push.ts';
import { assertRefName } from './refs.ts';
import { runGitOrThrow } from './run.ts';

export type BaseUpdate =
  | { status: 'current' | 'merged' | 'skipped' }
  | { status: 'conflicted'; files: string[] };

export interface UpdateOptions {
  signal?: AbortSignal;
  onBehind: () => Promise<void>;
}

const FETCH_TIMEOUT_MS = 2 * 60 * 1000;

const MISSING_REMOTE_REF = /couldn't find remote ref/i;

async function syncBaseRef(path: string, base: string, signal?: AbortSignal) {
  const branch = assertRefName(base);
  const ref = `refs/remotes/origin/${branch}`;
  const command = ['git', 'fetch', '--quiet', 'origin', '--', `+refs/heads/${branch}:${ref}`];
  const result = await runCommand(command, path, { timeoutMs: FETCH_TIMEOUT_MS, signal });
  if (result.ok) return ref;
  if (MISSING_REMOTE_REF.test(result.stderr)) return null;
  throw createPushError(command, result, false);
}

async function isBehind(path: string, ref: string, signal?: AbortSignal) {
  const command = ['git', 'merge-base', '--is-ancestor', ref, 'HEAD'];
  const result = await runCommand(command, path, { signal });
  if (result.code === 0 || result.code === 1) return result.code === 1;
  throw new Error(describeFailure(command, result));
}

async function abortMerge(path: string) {
  const merging = await runCommand(['git', 'rev-parse', '--quiet', '--verify', 'MERGE_HEAD'], path);
  if (merging.ok) await runGitOrThrow(['merge', '--abort'], path);
}

async function mergeBase(path: string, ref: string, message: string): Promise<BaseUpdate> {
  const command = ['git', 'merge', '--quiet', '--no-edit', '-m', message, ref];
  const result = await runCommand(command, path);
  if (result.ok) return { status: 'merged' };
  const unmerged = await runCommandOrThrow(
    ['git', '-c', 'core.quotePath=false', 'diff', '--name-only', '--diff-filter=U'],
    path
  );
  await abortMerge(path);
  const files = unmerged.split('\n').filter((file) => file.length > 0);
  if (files.length > 0) return { status: 'conflicted', files };
  throw new Error(describeFailure(command, result));
}

export async function updateOntoBase(
  path: string,
  base: string,
  branch: string,
  options: UpdateOptions
): Promise<BaseUpdate> {
  const ref = await syncBaseRef(path, base, options.signal);
  if (!ref || !(await isBehind(path, ref, options.signal))) return { status: 'current' };
  await options.onBehind();
  return mergeBase(path, ref, `Merge branch '${base}' into ${branch}`);
}
