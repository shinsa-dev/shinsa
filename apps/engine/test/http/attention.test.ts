import { describe, expect, test } from 'bun:test';
import type { ScopedActor, RequestOrigin } from '@shinsa/core';
import { Duration, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { ATTENTION_IDLE, type OwnerActivity } from '../../src/http/attention/schema.ts';
import { makeAttentionTracker } from '../../src/http/attention/service.ts';

interface Page {
  name: string;
  data: { origin: RequestOrigin; guest: ScopedActor | null };
}

function createPage(name: string, origin: RequestOrigin, guest: ScopedActor | null = null): Page {
  return { name, data: { origin, guest } };
}

const idleMs = Duration.toMillis(ATTENTION_IDLE);

function runTracker(
  body: (told: string[], tracker: Effect.Success<ReturnType<typeof makeTracker>>) => Effect.Effect<void>
) {
  const told: string[] = [];
  return Effect.runPromise(
    makeTracker(told).pipe(
      Effect.flatMap((tracker) => body(told, tracker)),
      Effect.scoped,
      Effect.provide(TestClock.layer())
    )
  );
}

function makeTracker(told: string[]) {
  return makeAttentionTracker<Page>((page, where) => told.push(`${page.name}:${where}`));
}

describe('the attention tracker', () => {
  test('tells the page you used last that it is here and every other page of yours that you are elsewhere', () =>
    runTracker((told, tracker) =>
      Effect.gen(function* () {
        const app = createPage('app', 'local');
        const laptop = createPage('laptop', 'owner');
        yield* tracker.report(app, false);
        yield* tracker.report(laptop, false);
        expect(told).toEqual(['app:nowhere', 'laptop:nowhere']);

        told.length = 0;
        yield* tracker.report(laptop, true);
        expect(told.sort()).toEqual(['app:elsewhere', 'laptop:here']);

        told.length = 0;
        yield* TestClock.adjust(Duration.seconds(1));
        yield* tracker.report(app, true);
        expect(told.sort()).toEqual(['app:here', 'laptop:elsewhere']);

        told.length = 0;
        yield* tracker.report(app, true);
        expect(told).toEqual([]);
      })
    ));

  test('tells every page you are nowhere once the last page you used has been idle for the window', () =>
    runTracker((told, tracker) =>
      Effect.gen(function* () {
        yield* tracker.report(createPage('phone', 'owner'), false);
        yield* tracker.report(createPage('app', 'local'), true);
        told.length = 0;

        yield* TestClock.adjust(Duration.millis(idleMs - 1));
        expect(told).toEqual([]);
        yield* TestClock.adjust(Duration.millis(1));
        expect(told.sort()).toEqual(['app:nowhere', 'phone:nowhere']);
      })
    ));

  test('hands the attention to the page used before when the one you used last closes', () =>
    runTracker((told, tracker) =>
      Effect.gen(function* () {
        const app = createPage('app', 'local');
        const laptop = createPage('laptop', 'owner');
        yield* tracker.report(app, true);
        yield* TestClock.adjust(Duration.millis(10));
        yield* tracker.report(laptop, true);
        told.length = 0;

        yield* tracker.remove(laptop);
        expect(told).toEqual(['app:here']);

        told.length = 0;
        yield* tracker.remove(app);
        yield* tracker.remove(createPage('never-reported', 'local'));
        yield* TestClock.adjust(ATTENTION_IDLE);
        expect(told).toEqual([]);
      })
    ));

  test('a member never takes the owner’s attention and always hears nowhere, and a guest is not tracked', () =>
    runTracker((told, tracker) =>
      Effect.gen(function* () {
        yield* tracker.report(createPage('app', 'local'), true);
        yield* tracker.report(createPage('member', 'remote'), true);
        yield* tracker.report(
          createPage('guest', 'remote', {
            id: 'u-kai',
            login: 'kai',
            name: null,
            avatarUrl: null,
            scope: { kind: 'task', taskId: 't-1' },
          }),
          true
        );
        expect(told).toEqual(['app:here', 'member:nowhere']);
      })
    ));
});

describe('the owner’s presence', () => {
  test('is here while one of your pages was used in the last five minutes, then away since you last used one', async () => {
    const reported: OwnerActivity[] = [];
    await Effect.runPromise(
      Effect.gen(function* () {
        const tracker = yield* makeAttentionTracker<Page>(
          () => undefined,
          (owner) => Effect.sync(() => void reported.push(owner))
        );
        const app = createPage('app', 'local');
        const teammate = createPage('kai', 'remote');
        yield* TestClock.adjust(Duration.seconds(1));
        yield* tracker.report(teammate, true);
        expect(reported.at(-1)).toEqual({ active: false, seenAt: null });
        yield* tracker.report(app, true);
        expect(reported.at(-1)).toEqual({ active: true, seenAt: 1_000 });
        yield* TestClock.adjust(ATTENTION_IDLE);
        expect(reported.at(-1)).toEqual({ active: false, seenAt: 1_000 });
        yield* tracker.report(app, true);
        yield* tracker.remove(app);
        expect(reported.at(-1)).toEqual({ active: false, seenAt: 1_000 + idleMs });
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer()))
    );
  });
});
