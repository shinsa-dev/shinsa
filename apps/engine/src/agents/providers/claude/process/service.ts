import { type ChildProcess, spawn as spawnChild } from 'node:child_process';
import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import { Effect, Ref, Stream } from 'effect';
import { Shell } from '../../../../shell/service.ts';
import { type ClaudeProcessDefinition, type ClaudeProcessHandle, STDERR_TAIL_CHARS } from './schema.ts';

export const makeClaudeProcess = Effect.fn('ClaudeProcess.make')(function* (
  definition: ClaudeProcessDefinition
) {
  const shell = yield* Shell;
  const child = yield* Ref.make<ChildProcess | null>(null);
  const stderr = yield* Ref.make('');

  const spawn = Effect.fn('ClaudeProcess.spawn')(function* (options: SpawnOptions) {
    const started = yield* Effect.sync(() => {
      const process = spawnChild(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        signal: options.signal,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
        windowsHide: true,
      });
      process.stderr.setEncoding('utf8');
      return process;
    });
    yield* Ref.set(child, started);
    yield* Stream.fromAsyncIterable(started.stderr as AsyncIterable<string>, String).pipe(
      Stream.runForEach((chunk) => Ref.update(stderr, (tail) => `${tail}${chunk}`.slice(-STDERR_TAIL_CHARS))),
      Effect.ignore,
      Effect.forkDetach
    );
    if (started.pid) yield* definition.onSpawn(started.pid);
    return started as unknown as SpawnedProcess;
  });

  const readStderr = Effect.map(Ref.get(stderr), (tail) => tail.trim());

  const terminate = Effect.gen(function* () {
    const current = yield* Ref.get(child);
    if (!current?.pid || current.exitCode !== null || current.signalCode !== null) return;
    yield* shell.stopTree(current.pid);
  });

  const handle: ClaudeProcessHandle = { spawn, readStderr, terminate };
  return handle;
});
