import { describe, expect, it } from 'bun:test';
import { Duration, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { CHANNELS } from '../../src/bridge/schema.ts';
import { createWorld, flush, offer, runDesktop } from '../support/desktop.ts';

function awaySent(world: ReturnType<typeof createWorld>) {
  return world.sent.filter(([channel]) => channel === CHANNELS.away).map(([, span]) => span);
}

describe('the away watch', () => {
  it('sends the page each span you were idle, locked or asleep', async () => {
    const world = createWorld();
    await runDesktop(
      world,
      Effect.gen(function* () {
        yield* flush;
        world.idleMs = 20 * 60_000;
        yield* TestClock.adjust(Duration.minutes(20));
        yield* flush;
        world.idleMs = 0;
        yield* TestClock.adjust(Duration.seconds(30));
        yield* flush;
        yield* offer(world.powerEvents, 'lock');
        yield* TestClock.adjust(Duration.hours(1));
        yield* offer(world.powerEvents, 'unlock');
      })
    );
    expect(awaySent(world)).toEqual([
      { from: 10 * 60_000, to: 20.5 * 60_000 },
      { from: 30.5 * 60_000, to: 80.5 * 60_000 },
    ]);
  });
});
