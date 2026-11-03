import type { ShinsaCommand, ShinsaState } from '@shinsa/core';
import { Effect } from 'effect';
import type { ShareClockDefinition, ShareClockTick } from './schema.ts';

export const makeShareClock = (definition: ShareClockDefinition) =>
  Effect.sync(() => {
    const createTick = (id: string, dueAt: number, command: ShinsaCommand): ShareClockTick => ({
      id,
      dueAt,
      fire: Effect.gen(function* () {
        const events = yield* definition.dispatch(command, id);
        if (events.length === 0) yield* definition.refuse(id);
      }),
    });

    return (state: ShinsaState) =>
      Object.values(state.tasks).flatMap((task) => {
        const ticks: ShareClockTick[] = [];
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
  });
