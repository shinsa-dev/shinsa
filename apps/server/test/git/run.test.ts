import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commitWorktree } from '../../src/git/index.ts';
import { runGitOrThrow } from '../../src/git/run.ts';
import { createGitRepo } from '../helpers/index.ts';

const restores: (() => void)[] = [];

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

function spyOnBackoff(onWait: () => void = () => undefined) {
  const waits: number[] = [];
  const sleep = spyOn(Bun, 'sleep').mockImplementation((ms) => {
    waits.push(Number(ms));
    onWait();
    return Promise.resolve();
  });
  restores.push(() => sleep.mockRestore());
  return waits;
}

describe('runGitOrThrow', () => {
  test('waits out another git process holding the index lock, then goes ahead', async () => {
    const { path } = await createGitRepo({ remote: false });
    writeFileSync(join(path, 'change.txt'), 'new\n');
    const lock = join(path, '.git', 'index.lock');
    writeFileSync(lock, '');
    const waits = spyOnBackoff(() => rmSync(lock, { force: true }));
    expect(await commitWorktree(path, 'chore: change')).toEqual({ merge: null });
    expect(waits).toEqual([50]);
    expect(await runGitOrThrow(['log', '-1', '--format=%s'], path)).toBe('chore: change');
  });

  test('gives up on a lock that never goes away, and never retries other failures', async () => {
    const { path } = await createGitRepo({ remote: false });
    writeFileSync(join(path, '.git', 'index.lock'), '');
    writeFileSync(join(path, 'change.txt'), 'new\n');
    const waits = spyOnBackoff();
    await expect(runGitOrThrow(['add', '-A'], path)).rejects.toThrow('index.lock');
    expect(waits).toEqual([50, 100, 200, 400, 800]);
    await expect(runGitOrThrow(['no-such-command'], path)).rejects.toThrow('git no-such-command failed');
    expect(waits).toHaveLength(5);
  });
});
