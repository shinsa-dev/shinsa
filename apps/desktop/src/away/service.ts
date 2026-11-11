import { applyPowerEvent, type AwayStep, NO_INPUT_YET, observeInput, type PowerEvent } from '@shinsa/core';
import { Clock, Effect, Layer, Ref, Stream } from 'effect';
import { CHANNELS } from '../bridge/schema.ts';
import { PowerMonitor } from '../power-monitor/service.ts';
import { AppWindow } from '../window/service.ts';
import { AWAY_POLL_SCHEDULE } from './schema.ts';

export const AwayWatch = Layer.effectDiscard(
  Effect.gen(function* () {
    const power = yield* PowerMonitor;
    const window = yield* AppWindow;
    const state = yield* Ref.make(NO_INPUT_YET);
    const step = Effect.fn('AwayWatch.step')(function* (event: PowerEvent | null) {
      const now = yield* Clock.currentTimeMillis;
      const idle = yield* power.idleMs;
      const current = yield* Ref.get(state);
      const next: AwayStep =
        event === null ? observeInput(current, now, idle) : applyPowerEvent(current, event, now, idle);
      yield* Ref.set(state, next.state);
      if (next.span) yield* window.sendToPage(CHANNELS.away, next.span);
    });
    yield* Effect.forkScoped(Effect.repeat(step(null), AWAY_POLL_SCHEDULE), { startImmediately: true });
    yield* Effect.forkScoped(Stream.runForEach(power.events, step), { startImmediately: true });
  })
);
