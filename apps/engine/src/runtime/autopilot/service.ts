import type { ShinsaState } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { makeEngineClock } from '../clock/engine.ts';
import type { EngineClock, EngineClockTick } from '../clock/schema.ts';
import type { EngineCore } from '../engine/service.ts';
import { AutopilotClockTimings } from './schema.ts';

export class AutopilotClock extends Context.Service<AutopilotClock, EngineClock>()(
  'shinsa/engine/runtime/autopilot/AutopilotClock'
) {
  static readonly layer = Layer.effect(
    AutopilotClock,
    Effect.gen(function* () {
      const listAutopilotTicks = (state: ShinsaState, engine: EngineCore['Service']) => {
        return Object.values(state.gates).flatMap((gate): EngineClockTick[] => {
          const due = gate.autopilotDue;
          if (gate.type !== 'merge' || gate.status !== 'open' || !due) return [];
          const id = `autopilot:${gate.id}:${due.at}`;
          const fire = engine.dispatch(
            { type: 'autopilot.fire', taskId: gate.taskId, gateId: gate.id, dueAt: due.at },
            { id }
          );
          return [{ id, dueAt: due.at, fire }];
        });
      };
      const clock = yield* makeEngineClock({
        area: 'Autopilot',
        failure: 'Could not act on an urgent change for you',
        timings: yield* AutopilotClockTimings,
        list: listAutopilotTicks,
      });
      return AutopilotClock.of(clock);
    })
  );
}
