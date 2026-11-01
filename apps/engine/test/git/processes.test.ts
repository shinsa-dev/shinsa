import { describe, expect, test } from 'bun:test';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { listProcessesIn, listWorkingFolderPids, stopProcessesIn } from '../../src/git/processes.ts';
import { createTempDir } from '../helpers/index.ts';

function spawnIn(cwd: string, script: string) {
  return Bun.spawn(['sh', '-c', script], { cwd, stdout: 'ignore', stderr: 'ignore' });
}

describe('processes left in a worktree', () => {
  test('a stray process in the folder is stopped and one outside it keeps running', async () => {
    const worktree = createTempDir();
    const elsewhere = createTempDir();
    const stray = spawnIn(worktree, 'sleep 30; true');
    const outside = spawnIn(elsewhere, 'sleep 30; true');
    expect(await listProcessesIn(worktree)).toContain(stray.pid);
    const stopped = await stopProcessesIn(worktree);
    expect(stopped).toContain(stray.pid);
    expect(await stray.exited).not.toBe(0);
    expect(outside.exitCode).toBeNull();
    outside.kill('SIGKILL');
    await outside.exited;
  });

  test('a process that ignores SIGTERM is killed after the grace period', async () => {
    const worktree = createTempDir();
    const stubborn = spawnIn(worktree, "trap '' TERM; sleep 30; true");
    await stopProcessesIn(worktree, { graceMs: 100 });
    await stubborn.exited;
    expect(stubborn.signalCode).toBe('SIGKILL');
  });

  test('a spared process and everything it started keep running', async () => {
    const worktree = createTempDir();
    const shell = spawnIn(worktree, 'sleep 30; true');
    expect(await stopProcessesIn(worktree, { spare: [shell.pid] })).toEqual([]);
    expect(shell.exitCode).toBeNull();
    shell.kill('SIGKILL');
    await shell.exited;
  });

  test('a folder that is gone has no processes', async () => {
    expect(await stopProcessesIn(join(createTempDir(), 'gone'))).toEqual([]);
  });

  test('only working folders inside the path count, not a sibling that shares its prefix', () => {
    const root = realpathSync(createTempDir());
    const output = ['p10', `n${root}`, 'p11', `n${root}/apps/web`, 'p12', `n${root}-2`, 'p13'].join('\n');
    expect(listWorkingFolderPids(output, root)).toEqual([10, 11]);
  });
});
