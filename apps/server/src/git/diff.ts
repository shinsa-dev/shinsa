import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CODE_LIMITS,
  DIFF_PATCH_LIMITS,
  type DiffFile,
  DomainError,
  mergeDiffPatches,
  parseDiffSummary,
  parseUnifiedDiff,
  selectPatchedFiles,
} from '@shinsa/core';
import { runCommandOrThrow } from '../shell/index.ts';
import { decodeText, readGit } from './read.ts';

const DIFF_ARGS = ['diff', '--no-color', '--no-ext-diff', '--find-renames'];

const DIFF_BYTES = 64 * 1024 * 1024;

const DIFF_TIMEOUT_MS = 30_000;

const NAMED_LIMITS = { fileBytes: CODE_LIMITS.blobBytes, totalBytes: 2 * CODE_LIMITS.blobBytes };

interface DiffSource {
  cwd: string;
  range: string[];
  env?: Record<string, string>;
  signal?: AbortSignal;
}

async function readDiffText(source: DiffSource, args: string[], paths: readonly string[]) {
  const read = await readGit([...DIFF_ARGS, ...args, ...source.range, '--', ...paths], source.cwd, {
    signal: source.signal,
    maxBytes: DIFF_BYTES,
    timeoutMs: DIFF_TIMEOUT_MS,
    env: source.env,
  });
  if (!read.ok || read.truncated)
    throw new DomainError('diff_failed', read.stderr || 'The change is too large to show.');
  return decodeText(read.bytes);
}

function listPatchPaths(files: readonly DiffFile[]) {
  return files.flatMap((file) => (file.previousPath ? [file.previousPath, file.path] : [file.path]));
}

async function readDiff(source: DiffSource, paths: readonly string[] | null): Promise<DiffFile[]> {
  if (paths?.length === 0) return [];
  const summary = parseDiffSummary(await readDiffText(source, ['--raw', '--numstat', '-z'], paths ?? []));
  const chosen = paths ? summary.filter((file) => !file.binary) : selectPatchedFiles(summary);
  if (chosen.length === 0) return mergeDiffPatches(summary, []);
  const patched = parseUnifiedDiff(await readDiffText(source, [], listPatchPaths(chosen)));
  return mergeDiffPatches(summary, patched, paths ? NAMED_LIMITS : DIFF_PATCH_LIMITS);
}

export function resolveCommitDiff(
  repoPath: string,
  base: string,
  head: string,
  signal?: AbortSignal,
  paths: readonly string[] | null = null
): Promise<DiffFile[]> {
  return readDiff({ cwd: repoPath, range: [base, head], signal }, paths);
}

export async function resolveWorkingDiff(
  worktree: string,
  base: string,
  paths: readonly string[] | null = null,
  signal?: AbortSignal
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
    return await readDiff({ cwd: worktree, range: [base], env, signal }, paths);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
