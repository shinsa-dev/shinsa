import { Effect } from 'effect';
import type { ScheduleClockDefinition, ScheduleClockHandle } from './schema.ts';

export const createScheduleClock = (definition: ScheduleClockDefinition): ScheduleClockHandle => {
  const fireDue = Effect.fn('ScheduleClock.fireDue')(function* (scheduleId: string) {
    const current = (yield* definition.state).schedules[scheduleId];
    if (!current?.enabled || current.nextRunAt === null || current.nextRunAt > (yield* definition.now))
      return null;
    const dueAt = current.nextRunAt;
    const id = `schedule:${scheduleId}:${dueAt}`;
    return yield* definition.dispatch({ type: 'schedule.fire', scheduleId, dueAt }, id).pipe(
      Effect.catch((failure) =>
        Effect.logWarning('[Schedules] A schedule could not run; recording the failure').pipe(
          Effect.annotateLogs({ scheduleId, error: failure.message }),
          Effect.andThen(
            definition.dispatch(
              {
                type: 'schedule.fail',
                scheduleId,
                dueAt,
                deliveryId: null,
                detail: failure._tag === 'DomainError' ? failure.message : 'Shinsa could not run it.',
              },
              `${id}:fail`
            )
          )
        )
      )
    );
  });

  const fire = Effect.fn('ScheduleClock.fire')(function* (scheduleId: string, entryId: string) {
    const events = yield* fireDue(scheduleId);
    if (events?.length === 0) yield* definition.refuse(entryId);
  });

  return { fire };
};
