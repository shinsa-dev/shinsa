import { isWatchdogScheduled, type ShinsaState } from '@shinsa/core';
import { Effect } from 'effect';
import type { WatchdogClockDefinition, WatchdogClockTick } from './schema.ts';

export const makeWatchdogClock = (definition: WatchdogClockDefinition) =>
  Effect.sync(
    () => (state: ShinsaState) =>
      Object.values(state.tasks).flatMap((task) =>
        (task.watchdogs ?? []).flatMap((watchdog): WatchdogClockTick[] => {
          const dueAt = watchdog.nextCheckAt;
          if (!isWatchdogScheduled(watchdog) || watchdog.runId !== null || dueAt === null) return [];
          const id = `watchdog:${watchdog.id}:${dueAt}`;
          const fire = Effect.gen(function* () {
            const events = yield* definition.dispatch(
              { type: 'watchdog.fire', taskId: task.id, watchdogId: watchdog.id, dueAt },
              id
            );
            if (events.length === 0) yield* definition.refuse(id);
          });
          return [{ id, dueAt, fire }];
        })
      )
  );
