import type { ShinsaState } from '@shinsa/core';
import { Effect } from 'effect';
import type { MonitorClockDefinition, MonitorClockTick } from './schema.ts';

export const makeMonitorClock = (definition: MonitorClockDefinition) =>
  Effect.sync(
    () => (state: ShinsaState) =>
      Object.values(state.tasks).flatMap((task): MonitorClockTick[] => {
        const monitor = task.monitor;
        if (monitor?.status !== 'armed') return [];
        const attempt = monitor.attempts + 1;
        const id = `monitor:${monitor.id}:${attempt}`;
        const fire = Effect.gen(function* () {
          const events = yield* definition.dispatch(
            { type: 'monitor.fire', taskId: task.id, monitorId: monitor.id, attempt },
            id
          );
          if (events.length === 0) yield* definition.refuse(id);
        });
        return [{ id, dueAt: Math.min(monitor.nextCheckAt, monitor.timeoutAt), fire }];
      })
  );
