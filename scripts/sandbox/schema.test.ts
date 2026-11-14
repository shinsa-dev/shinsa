import { describe, expect, test } from 'bun:test';
import { Effect, Fiber, Ref } from 'effect';
import { TestClock } from 'effect/testing';
import { PREVIEW_SHARE_POLL, PreviewPending, SandboxFailed } from './schema.ts';

const runPoll = (fail: (attempt: number) => PreviewPending | SandboxFailed) =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const read = Ref.updateAndGet(attempts, (count) => count + 1).pipe(
      Effect.flatMap((attempt) => Effect.fail(fail(attempt)))
    );
    const fiber = yield* Effect.forkChild(Effect.flip(Effect.retry(read, PREVIEW_SHARE_POLL)));
    yield* TestClock.adjust('10 seconds');
    const failure = yield* Fiber.join(fiber);
    return { failure, attempts: yield* Ref.get(attempts) };
  }).pipe(Effect.provide(TestClock.layer()), Effect.runPromise);

describe('the preview share poll', () => {
  test('reads again while the preview is pending, fifty times at most', async () => {
    const { failure, attempts } = await runPoll(() => new PreviewPending());
    expect(failure._tag).toBe('PreviewPending');
    expect(attempts).toBe(50);
  });

  test('stops at the first other failure', async () => {
    const { failure, attempts } = await runPoll(() => new SandboxFailed({ message: 'Sharing failed.' }));
    expect(failure._tag).toBe('SandboxFailed');
    expect(attempts).toBe(1);
  });
});
