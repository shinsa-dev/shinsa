import type { Monitor, ShinsaState } from '@shinsa/core';
import { type ClockEntry, StateClock, type StateClockOptions } from './clock.ts';
import type { Engine } from './engine.ts';

function resolveDueAt(monitor: Monitor) {
  return Math.min(monitor.nextCheckAt, monitor.timeoutAt);
}

export class MonitorClock extends StateClock {
  constructor(engine: Engine, options: StateClockOptions = {}) {
    super(engine, { area: 'Monitors', failure: 'Could not wake a waiting task', minDelayMs: 1_000 }, options);
  }

  protected listEntries(state: ShinsaState): ClockEntry[] {
    return Object.values(state.tasks).flatMap((task) => {
      const monitor = task.monitor;
      if (monitor?.status !== 'armed') return [];
      const attempt = monitor.attempts + 1;
      const id = `monitor:${monitor.id}:${attempt}`;
      const fire = async () => {
        const events = await this.engine.dispatch(
          { type: 'monitor.fire', taskId: task.id, monitorId: monitor.id, attempt },
          { id }
        );
        if (events.length === 0) this.refuse(id);
      };
      return [{ id, dueAt: resolveDueAt(monitor), fire }];
    });
  }
}
