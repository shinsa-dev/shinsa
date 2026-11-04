import type { ShinsaState } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { makeEngineClock } from '../clock/engine.ts';
import type { EngineClock, EngineClockTick } from '../clock/schema.ts';
import type { EngineCore } from '../engine/service.ts';
import { MonitorClockTimings } from './schema.ts';

export class MonitorClock extends Context.Service<MonitorClock, EngineClock>()(
  'shinsa/engine/runtime/monitors/MonitorClock'
) {
  static readonly layer = Layer.effect(
    MonitorClock,
    Effect.gen(function* () {
      const listMonitorTicks = (state: ShinsaState, engine: EngineCore['Service']) => {
        return Object.values(state.tasks).flatMap((task): EngineClockTick[] => {
          const monitor = task.monitor;
          if (monitor?.status !== 'armed') return [];
          const attempt = monitor.attempts + 1;
          const id = `monitor:${monitor.id}:${attempt}`;
          const fire = engine.dispatch(
            { type: 'monitor.fire', taskId: task.id, monitorId: monitor.id, attempt },
            { id }
          );
          return [{ id, dueAt: Math.min(monitor.nextCheckAt, monitor.timeoutAt), fire }];
        });
      };
      const clock = yield* makeEngineClock({
        area: 'Monitors',
        failure: 'Could not wake a waiting task',
        timings: yield* MonitorClockTimings,
        list: listMonitorTicks,
      });
      return MonitorClock.of(clock);
    })
  );
}
