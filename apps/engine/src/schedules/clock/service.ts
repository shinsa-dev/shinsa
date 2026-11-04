import type { ShinsaState } from '@shinsa/core';
import { Clock, Context, Effect, Layer } from 'effect';
import { makeEngineClock } from '../../runtime/clock/engine.ts';
import type { EngineClock, EngineClockTick } from '../../runtime/clock/schema.ts';
import type { EngineCore } from '../../runtime/engine/service.ts';
import { ScheduleClockTimings } from './schema.ts';

export class ScheduleClock extends Context.Service<ScheduleClock, EngineClock>()(
  'shinsa/engine/schedules/clock/ScheduleClock'
) {
  static readonly layer = Layer.effect(
    ScheduleClock,
    Effect.gen(function* () {
      const fire = Effect.fn('ScheduleClock.fire')(function* (
        engine: EngineCore['Service'],
        scheduleId: string
      ) {
        const current = (yield* engine.state).schedules[scheduleId];
        const now = yield* Clock.currentTimeMillis;
        if (!current?.enabled || current.nextRunAt === null || current.nextRunAt > now) return null;
        const dueAt = current.nextRunAt;
        const id = `schedule:${scheduleId}:${dueAt}`;
        return yield* engine.dispatch({ type: 'schedule.fire', scheduleId, dueAt }, { id }).pipe(
          Effect.catch((failure) =>
            Effect.logWarning('[Schedules] A schedule could not run; recording the failure').pipe(
              Effect.annotateLogs({ scheduleId, error: failure.message }),
              Effect.andThen(
                engine.dispatch(
                  {
                    type: 'schedule.fail',
                    scheduleId,
                    dueAt,
                    deliveryId: null,
                    detail: failure._tag === 'DomainError' ? failure.message : 'Shinsa could not run it.',
                  },
                  { id: `${id}:fail` }
                )
              )
            )
          )
        );
      });

      const listScheduleTicks = (state: ShinsaState, engine: EngineCore['Service']) =>
        Object.values(state.schedules).flatMap((schedule): EngineClockTick[] => {
          if (!schedule.enabled || schedule.nextRunAt === null) return [];
          const id = `schedule:${schedule.id}:${schedule.nextRunAt}:${schedule.updatedAt}`;
          return [{ id, dueAt: schedule.nextRunAt, fire: fire(engine, schedule.id) }];
        });

      const clock = yield* makeEngineClock({
        area: 'Schedules',
        failure: 'Could not run the due schedules',
        timings: yield* ScheduleClockTimings,
        list: listScheduleTicks,
      });
      return ScheduleClock.of(clock);
    })
  );
}
