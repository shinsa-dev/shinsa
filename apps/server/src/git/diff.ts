import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseUnifiedDiff, type Repo, type TaskDiff } from '@shinsa/core';
import { runCommand, runCommandOrThrow } from '../shell/index.ts';
import { assertRefName } from './refs.ts';

async function resolveDiffBase(repo: Repo, path: string, baseBranch: string | null) {
  if (baseBranch) return runCommandOrThrow(['git', 'merge-base', 'HEAD', assertRefName(baseBranch)], path);
  const branch = assertRefName(repo.defaultBranch);
  const remote = await runCommand(['git', 'merge-base', 'HEAD', `origin/${branch}`], path);
  if (remote.ok) return remote.stdout;
  return runCommandOrThrow(['git', 'merge-base', 'HEAD', branch], path);
}

export async function resolveTaskDiff(
  repo: Repo,
  path: string,
  baseBranch: string | null
): Promise<TaskDiff> {
  const base = await resolveDiffBase(repo, path, baseBranch);
  const index = await runCommandOrThrow(
    ['git', 'rev-parse', '--path-format=absolute', '--git-path', 'index'],
    path
  );
  const scratch = mkdtempSync(join(tmpdir(), 'shinsa-diff-'));
  const env = { GIT_INDEX_FILE: join(scratch, 'index') };
  try {
    if (existsSync(index)) {
      copyFileSync(index, env.GIT_INDEX_FILE);
      const { atime, mtime } = statSync(index);
      utimesSync(env.GIT_INDEX_FILE, atime, mtime);
    }
    await runCommandOrThrow(['git', 'add', '-A', '--intent-to-add'], path, { env });
    const text = await runCommandOrThrow(['git', 'diff', '--no-color', '--find-renames', base], path, {
      env,
    });
    return { base, files: parseUnifiedDiff(text) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
