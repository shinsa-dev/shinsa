import type { ShinsaState } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { makeEngineClock } from '../clock/engine.ts';
import type { EngineClock, EngineClockTick } from '../clock/schema.ts';
import type { EngineCore } from '../engine/service.ts';
import { AutoShipClockTimings } from './schema.ts';

export class AutoShipClock extends Context.Service<AutoShipClock, EngineClock>()(
  'shinsa/engine/runtime/auto-ship/AutoShipClock'
) {
  static readonly layer = Layer.effect(
    AutoShipClock,
    Effect.gen(function* () {
      const listAutoShipTicks = (state: ShinsaState, engine: EngineCore['Service']) => {
        return Object.values(state.gates).flatMap((gate): EngineClockTick[] => {
          const due = gate.autoShipDue;
          if (gate.type !== 'merge' || gate.status !== 'open' || !due) return [];
          const id = `auto_ship:${gate.id}:${due.at}`;
          const fire = engine.dispatch(
            { type: 'auto_ship.fire', taskId: gate.taskId, gateId: gate.id, dueAt: due.at },
            { id }
          );
          return [{ id, dueAt: due.at, fire }];
        });
      };
      const clock = yield* makeEngineClock({
        area: 'Auto-ship',
        failure: 'Could not act on an urgent change for you',
        timings: yield* AutoShipClockTimings,
        list: listAutoShipTicks,
      });
      return AutoShipClock.of(clock);
    })
  );
}
