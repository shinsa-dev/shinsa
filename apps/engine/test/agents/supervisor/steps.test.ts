import { describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Exit, Option } from 'effect';
import { AccountLeasing } from '../../../src/agents/accounts.ts';
import { createActiveRun } from '../../../src/agents/active/run.ts';
import { CLAUDE_CAPABILITIES } from '../../../src/agents/providers/claude/index.ts';
import { ProviderRegistry } from '../../../src/agents/providers/index.ts';
import { leaseAttempt } from '../../../src/agents/supervisor/attempts.ts';
import { isOverloadRetry, resolveOverloadDelay } from '../../../src/agents/supervisor/overload.ts';
import { prepareWorkspace } from '../../../src/agents/supervisor/workspace.ts';
import { RunWorld } from '../../../src/agents/supervisor/world/service.ts';
import { Transcripts } from '../../../src/agents/transcripts/index.ts';
import { WorktreeRoot } from '../../../src/workspaces/index.ts';
import { createTempDir, createTestConfig } from '../../helpers/index.ts';
import { createRun, createStubEngine } from '../../helpers/state.ts';

const overloaded = {
  class: 'overloaded' as const,
  message: 'busy',
  code: '529',
  retryable: true,
  resetAt: null,
};

function provideWorld(lease: () => Promise<null>) {
  const stub = createStubEngine();
  const config = createTestConfig();
  const transcripts = new Transcripts(config.transcriptsDir);
  const broker = {
    lease,
    readWeeklyReading: () => Promise.resolve(null),
    readProviderWeeklyReading: () => Promise.resolve(null),
    readFastMode: () => Promise.resolve('available' as const),
  };
  return Effect.provide(
    RunWorld.layer({
      engine: stub.engine,
      config,
      worktreeRoot: new WorktreeRoot({ defaultDir: config.worktreesDir }),
      transcripts,
      providers: new ProviderRegistry(),
      leasing: new AccountLeasing(broker, () => stub.state, transcripts),
      recordEntry: (runId, entry) => transcripts.record(runId, entry),
    })
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
      listModels: () => Promise.resolve([]),
      complete: () => Promise.resolve(null),
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
});
