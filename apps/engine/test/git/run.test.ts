import { describe, expect, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Clock, Effect, Fiber, Ref } from 'effect';
import { TestClock } from 'effect/testing';
import { commitWorktree } from '../../src/git/index.ts';
import { runGitOrThrow } from '../../src/git/run.ts';
import { GitFailed, LOCK_RETRY } from '../../src/git/schema.ts';
import { createGitRepo } from '../helpers/index.ts';

function recordAttempts(retryable: boolean) {
  return Effect.gen(function* () {
    const attempts = yield* Ref.make<number[]>([]);
    const attempt = Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.andThen(
        Ref.update(attempts, (all) => [...all, now]),
        Effect.fail(new GitFailed({ message: 'locked', retryable }))
      )
    );
    const fiber = yield* Effect.forkChild(Effect.flip(Effect.retry(attempt, LOCK_RETRY)));
    yield* TestClock.adjust('5 seconds');
    yield* Fiber.join(fiber);
    return yield* Ref.get(attempts);
  }).pipe(Effect.provide(TestClock.layer()));
}

describe('LOCK_RETRY', () => {
  test('waits 50 ms, then twice as long each time, and gives up after five waits', async () => {
    const attempts = await Effect.runPromise(recordAttempts(true));
    expect(attempts.slice(1).map((at, index) => at - (attempts[index] ?? 0))).toEqual([
      50, 100, 200, 400, 800,
    ]);
  });

  test('never retries a failure that is not a lock', async () => {
    expect(await Effect.runPromise(recordAttempts(false))).toHaveLength(1);
  });
});

describe('runGitOrThrow', () => {
  test('waits out another git process holding the index lock, then goes ahead', async () => {
    const { path } = await createGitRepo({ remote: false });
    writeFileSync(join(path, 'change.txt'), 'new\n');
    const lock = join(path, '.git', 'index.lock');
    writeFileSync(lock, '');
    const released = setTimeout(() => rmSync(lock, { force: true }), 30);
    expect(await commitWorktree(path, 'chore: change')).toEqual({ merge: null });
    clearTimeout(released);
    expect(await runGitOrThrow(['log', '-1', '--format=%s'], path)).toBe('chore: change');
  });

  test('gives up on a lock that never goes away, and never retries other failures', async () => {
    const { path } = await createGitRepo({ remote: false });
    writeFileSync(join(path, '.git', 'index.lock'), '');
    writeFileSync(join(path, 'change.txt'), 'new\n');
    await expect(runGitOrThrow(['add', '-A'], path)).rejects.toThrow('index.lock');
    const started = performance.now();
    await expect(runGitOrThrow(['no-such-command'], path)).rejects.toThrow('git no-such-command failed');
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  test('a run cancelled before it starts, or in a folder that is gone, fails without a retry', async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(runGitOrThrow(['status'], '/', { signal: cancelled.signal })).rejects.toThrow(
      'git status failed'
    );
    await expect(runGitOrThrow(['status'], '/nonexistent/shinsa/folder')).rejects.toThrow(
      'git status failed'
    );
  });
});
