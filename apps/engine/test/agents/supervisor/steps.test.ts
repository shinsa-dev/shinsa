import { describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DomainError, type ShinsaCommand } from '@shinsa/core';
import { Effect, Exit, Layer, Option } from 'effect';
import { AccountBroker, AccountBrokerFailed } from '../../../src/agents/accounts/schema.ts';
import { AccountLeasing } from '../../../src/agents/accounts/service.ts';
import { createActiveRun } from '../../../src/agents/active/run.ts';
import { CLAUDE_CAPABILITIES } from '../../../src/agents/providers/claude/index.ts';
import { Providers } from '../../../src/agents/providers/index.ts';
import { leaseAttempt } from '../../../src/agents/supervisor/attempts.ts';
import { isOverloadRetry, resolveOverloadDelay } from '../../../src/agents/supervisor/overload.ts';
import { prepareWorkspace } from '../../../src/agents/supervisor/workspace.ts';
import { RunWorld } from '../../../src/agents/supervisor/world/service.ts';
import { EngineConfig } from '../../../src/config/service.ts';
import { GitLayer } from '../../../src/git/layers.ts';
import { EngineCore } from '../../../src/runtime/engine/service.ts';
import { ShellLayer } from '../../../src/shell/layers.ts';
import { createTempDir, createTestConfig } from '../../helpers/index.ts';
import { createRun, createStubEngine } from '../../helpers/state.ts';
import { createTranscriptsLayer } from '../../helpers/transcripts.ts';

const overloaded = {
  class: 'overloaded' as const,
  message: 'busy',
  code: '529',
  retryable: true,
  resetAt: null,
};

function provideWorld(lease: () => Promise<null>, stub = createStubEngine()) {
  const config = createTestConfig();
  const broker = {
    lease: () =>
      Effect.tryPromise({
        try: lease,
        catch: (error) => new AccountBrokerFailed({ message: (error as Error).message }),
      }),
    readWeeklyReading: () => Effect.succeed(null),
    readProviderWeeklyReading: () => Effect.succeed(null),
    readFastMode: () => Effect.succeed('available' as const),
  };
  return Effect.provide(
    RunWorld.layer.pipe(
      Layer.provide(AccountLeasing.layer),
      Layer.provideMerge(
        Layer.mergeAll(
          createTranscriptsLayer(config.transcriptsDir),
          Layer.succeed(EngineCore, stub.engine.core),
          Layer.succeed(EngineConfig, config),
          Layer.succeed(Providers, Providers.make([])),
          Layer.succeed(AccountBroker, broker),
          GitLayer.pipe(Layer.provide(ShellLayer))
        )
      )
    )
  );
}

describe('the overload retry schedule', () => {
  test('waits the base delay, then doubles it, and gives up after three retries', async () => {
    const delays = await Effect.runPromise(
      Effect.forEach([1, 2, 3, 4], (attempt) => resolveOverloadDelay(attempt, 250))
    );
    expect(delays).toEqual([Option.some(250), Option.some(500), Option.some(1000), Option.none()]);
  });

  test('a run that already retried three times, or is stopping, is not retried', async () => {
    const active = createActiveRun('task-1', Promise.resolve(), {
      steerable: true,
      delegated: false,
      delivery: null,
    });
    const result = { outcome: 'failed' as const, summary: 'busy', failure: overloaded };
    const retry = (shuttingDown: boolean) =>
      Effect.runPromise(
        isOverloadRetry(active, result, shuttingDown).pipe(provideWorld(() => Promise.resolve(null)))
      );
    expect(await retry(false)).toBe(true);
    expect(await retry(true)).toBe(false);
    active.overloads = 3;
    expect(await retry(false)).toBe(false);
  });
});

describe('the steps of a turn', () => {
  test('a scratch folder that cannot be made fails with WorkspaceUnavailable', async () => {
    const file = join(createTempDir(), 'taken');
    writeFileSync(file, '');
    const exit = await Effect.runPromiseExit(
      prepareWorkspace({ cwd: join(file, 'scratch'), repo: null, defaultBranch: 'main' })
    );
    expect(exit).toMatchObject(Exit.fail(expect.objectContaining({ _tag: 'WorkspaceUnavailable' })));
  });

  test('an account broker that fails leaves LeaseFailed with its reason', async () => {
    const active = createActiveRun('task-1', Promise.resolve(), {
      steerable: true,
      delegated: false,
      delivery: null,
    });
    const provider = {
      id: 'claude',
      label: 'Claude',
      capabilities: CLAUDE_CAPABILITIES,
      startSession: () => {
        throw new Error('not started');
      },
      listModels: Effect.succeed([]),
      complete: () => Effect.succeed(null),
    };
    const turn = {
      run: createRun(),
      cwd: '/tmp',
      defaultBranch: 'main',
      prompt: '',
      brief: '',
      stepPrompt: true,
      provider,
      active,
    };
    const exit = await Effect.runPromiseExit(
      leaseAttempt(turn).pipe(provideWorld(() => Promise.reject(new Error('cswap broke'))))
    );
    expect(exit).toMatchObject(
      Exit.fail(expect.objectContaining({ _tag: 'LeaseFailed', message: 'cswap broke' }))
    );
  });

  test('a dispatch the engine refuses keeps its DomainError, and any other failure is RunDispatchFailed', async () => {
    const stub = createStubEngine();
    stub.reject(
      (command) => command.type === 'run.end',
      new DomainError({ code: 'run_gone', message: 'Gone.' })
    );
    stub.reject((command) => command.type === 'run.link', new Error('the log is closed'));
    const dispatch = (command: ShinsaCommand) =>
      Effect.runPromise(
        Effect.flip(RunWorld.use((world) => world.dispatch(command))).pipe(
          provideWorld(() => Promise.resolve(null), stub)
        )
      );
    expect(
      await dispatch({ type: 'run.end', runId: 'run-1', outcome: 'completed', summary: null })
    ).toMatchObject({
      code: 'run_gone',
    });
    expect(
      await dispatch({ type: 'run.link', runId: 'run-1', sessionId: 's', attemptId: 'a', provider: 'claude' })
    ).toMatchObject({ _tag: 'RunDispatchFailed', message: 'the log is closed' });
  });
});
