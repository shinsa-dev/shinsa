import { describe, expect, test } from 'bun:test';
import type { RemoteTeam } from '@shinsa/core';
import { Clock, Effect, Fiber, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import { Presence } from '../../src/remote/presence/service.ts';

const TEAM: Pick<RemoteTeam, 'owner' | 'members'> = {
  owner: { id: 'mona', login: 'mona', name: null, avatarUrl: null },
  members: [
    { user: { id: 'kai', login: 'kai', name: null, avatarUrl: null }, addedAt: 1 },
    { user: { id: 'tess', login: 'tess', name: null, avatarUrl: null }, addedAt: 2 },
  ],
};

describe('presence on this machine', () => {
  test('the machine’s owner is online or away; a teammate is online while any view is open, then last seen', async () => {
    const changes: number[] = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const presence = yield* Presence;
          yield* TestClock.setTime(10);
          const listen = yield* Effect.forkScoped(
            Effect.scoped(
              Effect.gen(function* () {
                yield* presence.observe(
                  Effect.flatMap(Clock.currentTimeMillis, (at) => Effect.sync(() => void changes.push(at)))
                );
                return yield* Effect.never;
              })
            )
          );
          yield* Effect.yieldNow;
          expect(yield* presence.listTeam(TEAM, 'mona')).toEqual([
            { userId: 'mona', status: 'away', seenAt: null },
          ]);
          yield* presence.openViewer('kai');
          yield* presence.openViewer('kai');
          yield* TestClock.setTime(20);
          yield* presence.closeViewer('kai');
          expect((yield* presence.listTeam(TEAM, 'mona'))[1]).toEqual({
            userId: 'kai',
            status: 'online',
            seenAt: 20,
          });
          yield* TestClock.setTime(30);
          yield* presence.closeViewer('kai');
          yield* presence.closeViewer('kai');
          yield* presence.closeViewer('tess');
          expect(yield* presence.listTeam(TEAM, 'mona')).toEqual([
            { userId: 'mona', status: 'away', seenAt: null },
            { userId: 'kai', status: 'offline', seenAt: 30 },
          ]);
          yield* presence.recordOwner({ active: true, seenAt: 25 });
          yield* presence.recordOwner({ active: true, seenAt: 25 });
          expect((yield* presence.listTeam(TEAM, 'mona'))[0]).toEqual({
            userId: 'mona',
            status: 'online',
            seenAt: 25,
          });
          expect(changes).toEqual([10, 30, 30]);
          yield* Fiber.interrupt(listen);
          yield* presence.openViewer('tess');
          expect(changes).toHaveLength(3);
        }).pipe(Effect.provide(Layer.merge(Presence.layer, TestClock.layer())))
      )
    );
  });
});
