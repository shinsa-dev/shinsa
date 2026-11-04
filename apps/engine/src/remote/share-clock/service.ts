import type { ShinsaCommand, ShinsaState } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { makeEngineClock } from '../../runtime/clock/engine.ts';
import type { EngineClock, EngineClockTick } from '../../runtime/clock/schema.ts';
import type { EngineCore } from '../../runtime/engine/service.ts';
import { ShareClockTimings } from './schema.ts';

export class ShareClock extends Context.Service<ShareClock, EngineClock>()(
  'shinsa/engine/remote/share-clock/ShareClock'
) {
  static readonly layer = Layer.effect(
    ShareClock,
    Effect.gen(function* () {
      const listShareTicks = (state: ShinsaState, engine: EngineCore['Service']) => {
        const createTick = (id: string, dueAt: number, command: ShinsaCommand): EngineClockTick => ({
          id,
          dueAt,
          fire: engine.dispatch(command, { id }),
        });
        return Object.values(state.tasks).flatMap((task) => {
          const ticks: EngineClockTick[] = [];
          const shareEndsAt = task.share?.endsAt ?? null;
          if (shareEndsAt !== null)
            ticks.push(
              createTick(`share:${task.id}:${shareEndsAt}`, shareEndsAt, {
                type: 'share.expire',
                taskId: task.id,
              })
            );
          for (const preview of task.previews ?? []) {
            if (preview.endsAt === null) continue;
            const id = `preview:${task.id}:${preview.serviceId}:${preview.endsAt}`;
            ticks.push(
              createTick(id, preview.endsAt, {
                type: 'preview.expire',
                taskId: task.id,
                serviceId: preview.serviceId,
              })
            );
          }
          return ticks;
        });
      };
      const clock = yield* makeEngineClock({
        area: 'Share',
        failure: 'Could not end a share that ran out',
        timings: yield* ShareClockTimings,
        list: listShareTicks,
      });
      return ShareClock.of(clock);
    })
  );
}
