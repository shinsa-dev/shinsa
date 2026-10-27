import { describe, expect, test } from 'bun:test';
import { utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIFF_PATCH_LIMITS } from '@shinsa/core';
import { createWorktree, resolveCommitDiff, resolveWorkingDiff } from '../../src/git/index.ts';
import { createGitRepo, createTempDir, git, writeFiles } from '../helpers/index.ts';

describe('resolveWorkingDiff', () => {
  test('shows new files without touching the index an agent may be using', async () => {
    const { repo } = await createGitRepo();
    const worktree = await createWorktree(repo, createTempDir(), 'task-cccccc', 'fix/diff', null);
    writeFiles(worktree.path, { 'new.ts': 'export {};\n', 'README.md': '# changed\n' });
    const files = await resolveWorkingDiff(worktree.path, await git(worktree.path, 'rev-parse', 'HEAD'));
    expect(files.map((file) => file.path).sort()).toEqual(['README.md', 'new.ts']);
    expect(await git(worktree.path, 'status', '--porcelain')).toBe('M README.md\n?? new.ts');
  });

  test('an edit that keeps the size, in the same second the index was written, still shows', async () => {
    const { repo } = await createGitRepo({ remote: false, files: { 'app.ts': 'export const value = 1;\n' } });
    const worktree = await createWorktree(repo, createTempDir(), 'task-ffffff', 'fix/racy', null);
    await git(worktree.path, 'config', 'core.trustctime', 'false');
    const file = join(worktree.path, 'app.ts');
    const index = await git(worktree.path, 'rev-parse', '--path-format=absolute', '--git-path', 'index');
    const second = new Date(1_700_000_000_000);
    utimesSync(file, second, second);
    await git(worktree.path, 'update-index', '--refresh');
    utimesSync(index, second, second);
    writeFileSync(file, 'export const value = 2;\n');
    utimesSync(file, second, second);
    const files = await resolveWorkingDiff(worktree.path, await git(worktree.path, 'rev-parse', 'HEAD'));
    expect(files.map((entry) => entry.path)).toEqual(['app.ts']);
  });

  test('names a path with spaces and accents as it is, unquoted', async () => {
    const { repo } = await createGitRepo({ remote: false });
    const worktree = await createWorktree(repo, createTempDir(), 'task-aaaaab', 'fix/names', null);
    writeFiles(worktree.path, { 'docs/café notes.md': 'hi\n' });
    const files = await resolveWorkingDiff(worktree.path, await git(worktree.path, 'rev-parse', 'HEAD'));
    expect(files.map((entry) => entry.path)).toEqual(['docs/café notes.md']);
  });
});

describe('resolveCommitDiff', () => {
  test('diffs two commits, renames and binary files included, without a working copy', async () => {
    const { path } = await createGitRepo({
      remote: false,
      files: { 'old.ts': 'export const a = 1;\n'.repeat(20) },
    });
    const base = await git(path, 'rev-parse', 'HEAD');
    await git(path, 'mv', 'old.ts', 'new.ts');
    writeFileSync(join(path, 'logo.png'), new Uint8Array([137, 80, 78, 71, 0, 1, 2]));
    await git(path, 'add', '-A');
    await git(path, 'commit', '-q', '-m', 'feat: rename');
    const head = await git(path, 'rev-parse', 'HEAD');
    const files = await resolveCommitDiff(path, base, head);
    expect(files.find((file) => file.path === 'new.ts')).toMatchObject({
      status: 'renamed',
      previousPath: 'old.ts',
    });
    expect(files.find((file) => file.path === 'logo.png')).toMatchObject({ status: 'added', binary: true });
    expect(await resolveCommitDiff(path, head, head)).toEqual([]);
  });

  test('leaves out the patch of a file too large to send with the list, and reads it when named', async () => {
    const { path } = await createGitRepo({ remote: false, files: { 'small.ts': 'a\n' } });
    const base = await git(path, 'rev-parse', 'HEAD');
    writeFileSync(join(path, 'long.ts'), 'x\n'.repeat(DIFF_PATCH_LIMITS.fileLines + 1));
    writeFileSync(join(path, 'small.ts'), 'b\n');
    await git(path, 'add', '-A');
    await git(path, 'commit', '-q', '-m', 'feat: long');
    const head = await git(path, 'rev-parse', 'HEAD');
    const files = await resolveCommitDiff(path, base, head);
    expect(files.map((file) => [file.path, file.patchOmitted, file.additions])).toEqual([
      ['long.ts', true, DIFF_PATCH_LIMITS.fileLines + 1],
      ['small.ts', false, 1],
    ]);
    const [named] = await resolveCommitDiff(path, base, head, undefined, ['long.ts']);
    expect(named).toMatchObject({ path: 'long.ts', patchOmitted: false });
    expect(await resolveCommitDiff(path, base, head, undefined, [])).toEqual([]);
  });

  test('a commit the repository lacks is a refusal, not a crash', async () => {
    const { path } = await createGitRepo({ remote: false });
    const head = await git(path, 'rev-parse', 'HEAD');
    await expect(resolveCommitDiff(path, head, 'f'.repeat(40))).rejects.toMatchObject({
      code: 'diff_failed',
    });
  });
});
