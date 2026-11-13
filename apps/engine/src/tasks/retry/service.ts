import { isRetryArmed, type ShinsaState } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { makeEngineClock } from '../../runtime/clock/engine.ts';
import type { EngineClock, EngineClockTick } from '../../runtime/clock/schema.ts';
import type { EngineCore } from '../../runtime/engine/service.ts';
import { resolveRetryCommandId } from './command.ts';
import { TaskRetryTimings } from './schema.ts';

export class TaskRetry extends Context.Service<TaskRetry, EngineClock>()(
  'shinsa/engine/tasks/retry/TaskRetry'
) {
  static readonly layer = Layer.effect(
    TaskRetry,
    Effect.gen(function* () {
      const listRetryTicks = (state: ShinsaState, engine: EngineCore['Service']) => {
        return Object.values(state.tasks).flatMap((task): EngineClockTick[] => {
          const retry = task.autoRetry;
          if (!retry || !isRetryArmed(task)) return [];
          const id = resolveRetryCommandId(task.id, retry);
          const fire = engine.dispatch({ type: 'task.auto_retry', taskId: task.id }, { id });
          return [{ id, dueAt: retry.at, fire }];
        });
      };
      const clock = yield* makeEngineClock({
        area: 'Tasks',
        failure: 'Could not retry a task',
        timings: yield* TaskRetryTimings,
        list: listRetryTicks,
      });
      return TaskRetry.of(clock);
    })
  );
}
