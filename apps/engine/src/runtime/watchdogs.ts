import { isWatchdogScheduled, type ShinsaState } from '@shinsa/core';
import { type ClockEntry, StateClock, type StateClockOptions } from './clock.ts';
import type { Engine } from './engine.ts';

export class WatchdogClock extends StateClock {
  constructor(engine: Engine, options: StateClockOptions = {}) {
    super(
      engine,
      { area: 'Watchdogs', failure: 'Could not run a watchdog check', minDelayMs: 1_000 },
      options
    );
  }

  protected listEntries(state: ShinsaState): ClockEntry[] {
    return Object.values(state.tasks).flatMap((task) =>
      (task.watchdogs ?? []).flatMap((watchdog) => {
        const dueAt = watchdog.nextCheckAt;
        if (!isWatchdogScheduled(watchdog) || watchdog.runId !== null || dueAt === null) return [];
        const id = `watchdog:${watchdog.id}:${dueAt}`;
        const fire = async () => {
          const events = await this.engine.dispatch(
            { type: 'watchdog.fire', taskId: task.id, watchdogId: watchdog.id, dueAt },
            { id }
          );
          if (events.length === 0) this.refuse(id);
        };
        return [{ id, dueAt, fire }];
      })
    );
  }
}
