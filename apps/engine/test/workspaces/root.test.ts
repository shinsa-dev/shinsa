import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { assertWorktreeRoot, describeWorktreeRootProblem, WorktreeRoot } from '../../src/workspaces/index.ts';
import { createTempDir } from '../helpers/index.ts';

describe('the worktree folder', () => {
  test('the environment wins over config.json, and config.json over the default', () => {
    const defaultDir = createTempDir();
    let configured: string | null = '/Volumes/bucket/worktrees';
    const root = new WorktreeRoot({ defaultDir, readConfigured: () => configured });
    expect(root.resolve()).toEqual({ path: '/Volumes/bucket/worktrees', source: 'config' });
    configured = null;
    expect(root.resolve()).toEqual({ path: defaultDir, source: 'default' });
    expect(root.path).toBe(defaultDir);
    const fromEnvironment = new WorktreeRoot({
      defaultDir: '/env/worktrees',
      fromEnvironment: true,
      readConfigured: () => '/Volumes/bucket/worktrees',
    });
    expect(fromEnvironment.resolve()).toEqual({ path: '/env/worktrees', source: 'environment' });
  });

  test('a chosen folder must exist, be a folder and be writable', () => {
    const problemOf = (path: string) => Effect.runSync(describeWorktreeRootProblem(path));
    const base = createTempDir();
    const missing = join(base, 'bucket');
    expect(problemOf(missing)).toBe(
      `The worktree folder ${missing} does not exist. If it is on a drive you mount, mount it again, or choose another folder in Settings → Projects.`
    );
    const file = join(base, 'file');
    writeFileSync(file, '');
    expect(problemOf(file)).toBe(`The worktree folder ${file} is not a folder.`);
    const locked = join(base, 'locked');
    mkdirSync(locked);
    chmodSync(locked, 0o500);
    expect(problemOf(locked)).toBe(`Shinsa cannot write to the worktree folder ${locked}.`);
    chmodSync(locked, 0o700);
    expect(problemOf(locked)).toBeNull();
  });

  test('only a chosen folder is checked; the default one is made when needed', async () => {
    const missing = join(createTempDir(), 'gone');
    expect(await Effect.runPromise(assertWorktreeRoot({ path: missing, source: 'default' }))).toBe(missing);
    const failure = await Effect.runPromise(
      Effect.flip(assertWorktreeRoot({ path: missing, source: 'config' }))
    );
    expect(failure._tag).toBe('WorktreeRootUnavailable');
    expect(failure.path).toBe(missing);
    const present = createTempDir();
    expect(await Effect.runPromise(assertWorktreeRoot({ path: present, source: 'environment' }))).toBe(
      present
    );
  });
});
