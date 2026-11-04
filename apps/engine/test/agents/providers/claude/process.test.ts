import { expect, test } from 'bun:test';
import { Effect, ManagedRuntime } from 'effect';
import { makeClaudeProcess } from '../../../../src/agents/providers/claude/process/service.ts';
import { ShellLayer } from '../../../../src/shell/layers.ts';
import { createTempDir, until } from '../../../helpers/index.ts';

function isAlive(pid: number) {
  const state = Bun.spawnSync(['ps', '-o', 'stat=', '-p', String(pid)])
    .stdout.toString()
    .trim();
  return state !== '' && !state.startsWith('Z');
}

test('the process keeps the tail of its stderr and is stopped with the background work it started', async () => {
  const pids: number[] = [];
  const runtime = ManagedRuntime.make(ShellLayer);
  const handle = await runtime.runPromise(
    makeClaudeProcess({ onSpawn: (pid) => Effect.sync(() => pids.push(pid)) })
  );
  const claude = {
    terminate: () => runtime.runPromise(handle.terminate),
    readStderr: () => runtime.runSync(handle.readStderr),
  };
  await claude.terminate();
  const spawned = runtime.runSync(
    handle.spawn({
      command: 'perl',
      args: [
        '-e',
        '$| = 1; print STDERR "starting up\\n"; my $pid = fork(); if ($pid == 0) { setpgrp(0, 0); sleep 30; exit 0 } print "$pid\\n"; sleep 30',
      ],
      cwd: createTempDir(),
      env: { PATH: Bun.env.PATH },
      signal: new AbortController().signal,
    })
  );
  const exited = new Promise<void>((resolve) => spawned.once('exit', () => resolve()));
  const background = await new Promise<number>((resolve) =>
    spawned.stdout.once('data', (chunk: Buffer) => resolve(Number(chunk.toString().trim())))
  );
  await until('stderr to arrive', () => claude.readStderr() === 'starting up');
  expect(pids).toEqual([(spawned as unknown as { pid: number }).pid]);
  expect(isAlive(background)).toBe(true);
  await claude.terminate();
  await exited;
  await until('the background work to stop', () => !isAlive(background));
  await claude.terminate();
  await runtime.dispose();
});
