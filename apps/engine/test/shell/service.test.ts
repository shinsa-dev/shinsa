import { describe, expect, test } from 'bun:test';
import { realpathSync } from 'node:fs';
import { Duration, Effect } from 'effect';
import { stopProcess } from '../../src/shell/processes.ts';
import { CommandNotFound } from '../../src/shell/schema.ts';
import { Shell } from '../../src/shell/service.ts';
import { runTest } from '../harness.ts';
import { captureLogs, createTempDir, overrideEnv, until } from '../helpers/index.ts';

function isRunning(pid: number) {
  const state = Bun.spawnSync(['ps', '-o', 'stat=', '-p', String(pid)])
    .stdout.toString()
    .trim();
  return state !== '' && !state.startsWith('Z');
}

describe('Shell', () => {
  test('runs argv in its folder and answers the trimmed result', async () => {
    const cwd = createTempDir();
    const result = await runTest(
      Shell.use((shell) => shell.run({ argv: ['sh', '-c', 'pwd -P; exit 2'], cwd, timeout: null }))
    );
    expect(result).toEqual({ ok: false, code: 2, stdout: realpathSync(cwd), stderr: '', timedOut: false });
  });

  test('a program that is not installed fails with CommandNotFound', async () => {
    const error = await runTest(
      Effect.flip(
        Shell.use((shell) =>
          shell.run({ argv: ['shinsa-no-such-program'], cwd: createTempDir(), timeout: Duration.seconds(5) })
        )
      )
    );
    expect(error).toBeInstanceOf(CommandNotFound);
    expect(error.command).toBe('shinsa-no-such-program');
    expect(error.message.length).toBeGreaterThan(0);
  });

  test('a cancel that never comes leaves the command to finish', async () => {
    const result = await runTest(
      Shell.use((shell) =>
        shell.run({ argv: ['echo', 'done'], cwd: createTempDir(), timeout: null, cancel: Effect.never })
      )
    );
    expect(result).toEqual({ ok: true, code: 0, stdout: 'done', stderr: '', timedOut: false });
  });

  test('stops a process even when the process table cannot be read', async () => {
    const leader = Bun.spawn(['sleep', '30'], { detached: true });
    const restore = overrideEnv({ PATH: createTempDir() });
    try {
      await runTest(Shell.use((shell) => shell.stopTree(leader.pid)));
    } finally {
      restore();
    }
    await leader.exited;
    await until('the leader to stop', () => !isRunning(leader.pid));
  });
});

describe('stopProcess', () => {
  test('a process that is already gone is not reported', async () => {
    const gone = Bun.spawn(['true']);
    await gone.exited;
    const logs = captureLogs();
    try {
      await runTest(stopProcess(gone.pid));
      expect(logs.entries).toEqual([]);
    } finally {
      logs.restore();
    }
  });
});
