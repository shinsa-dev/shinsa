import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DiffFile, DomainError, parseUnifiedDiff } from '@shinsa/core';
import { runCommandOrThrow } from '../shell/index.ts';
import { decodeText, readGit } from './read.ts';

const DIFF_ARGS = ['diff', '--no-color', '--no-ext-diff', '--find-renames'];

const DIFF_BYTES = 64 * 1024 * 1024;

const DIFF_TIMEOUT_MS = 30_000;

export async function resolveCommitDiff(
  repoPath: string,
  base: string,
  head: string,
  signal?: AbortSignal
): Promise<DiffFile[]> {
  const read = await readGit([...DIFF_ARGS, base, head, '--'], repoPath, {
    signal,
    maxBytes: DIFF_BYTES,
    timeoutMs: DIFF_TIMEOUT_MS,
  });
  if (!read.ok || read.truncated)
    throw new DomainError('diff_failed', read.stderr || 'The change is too large to show.');
  return parseUnifiedDiff(decodeText(read.bytes));
}

export async function resolveWorkingDiff(
  worktree: string,
  base: string,
  paths: readonly string[] | null = null
): Promise<DiffFile[]> {
  const index = await runCommandOrThrow(
    ['git', 'rev-parse', '--path-format=absolute', '--git-path', 'index'],
    worktree
  );
  const scratch = mkdtempSync(join(tmpdir(), 'shinsa-diff-'));
  const env = { GIT_INDEX_FILE: join(scratch, 'index') };
  try {
    if (existsSync(index)) {
      copyFileSync(index, env.GIT_INDEX_FILE);
      const { atime, mtime } = statSync(index);
      utimesSync(env.GIT_INDEX_FILE, atime, mtime);
    }
    await runCommandOrThrow(['git', 'add', '-A', '--intent-to-add'], worktree, { env });
    const text = await runCommandOrThrow(
      ['git', '-c', 'core.quotePath=false', ...DIFF_ARGS, base, '--', ...(paths ?? [])],
      worktree,
      { env: { ...env, GIT_LITERAL_PATHSPECS: '1' } }
    );
    return parseUnifiedDiff(text);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
