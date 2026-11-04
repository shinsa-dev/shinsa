import { isWatchdogScheduled, type ShinsaState } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { makeEngineClock } from '../clock/engine.ts';
import type { EngineClock, EngineClockTick } from '../clock/schema.ts';
import type { EngineCore } from '../engine/service.ts';
import { WatchdogClockTimings } from './schema.ts';

export class WatchdogClock extends Context.Service<WatchdogClock, EngineClock>()(
  'shinsa/engine/runtime/watchdogs/WatchdogClock'
) {
  static readonly layer = Layer.effect(
    WatchdogClock,
    Effect.gen(function* () {
      const listWatchdogTicks = (state: ShinsaState, engine: EngineCore['Service']) => {
        return Object.values(state.tasks).flatMap((task) =>
          (task.watchdogs ?? []).flatMap((watchdog): EngineClockTick[] => {
            const dueAt = watchdog.nextCheckAt;
            if (!isWatchdogScheduled(watchdog) || watchdog.runId !== null || dueAt === null) return [];
            const id = `watchdog:${watchdog.id}:${dueAt}`;
            const fire = engine.dispatch(
              { type: 'watchdog.fire', taskId: task.id, watchdogId: watchdog.id, dueAt },
              { id }
            );
            return [{ id, dueAt, fire }];
          })
        );
      };
      const clock = yield* makeEngineClock({
        area: 'Watchdogs',
        failure: 'Could not run a watchdog check',
        timings: yield* WatchdogClockTimings,
        list: listWatchdogTicks,
      });
      return WatchdogClock.of(clock);
    })
  );
}
