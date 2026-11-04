import type { UsageWait } from '@shinsa/core';
import { Clock, Context, Duration, Effect, Layer, Ref } from 'effect';
import { constant } from 'effect/Function';
import { describeError } from '../../log/redact.ts';
import { MAX_CLOCK_DELAY } from '../../runtime/clock/schema.ts';
import { makeStateClock } from '../../runtime/clock/service.ts';
import { EngineCore } from '../../runtime/engine/service.ts';
import { resolveResumeCommandId } from './command.ts';
import { RESUME_MIN_DELAY, UsageResumeTimingSettings } from './schema.ts';

export class UsageResume extends Context.Service<
  UsageResume,
  {
    readonly start: Effect.Effect<void>;
    readonly stop: Effect.Effect<void>;
    readonly fireDue: Effect.Effect<void>;
  }
>()('shinsa/engine/accounts/resume/UsageResume') {
  static readonly layer = Layer.effect(
    UsageResume,
    Effect.gen(function* () {
      const engine = yield* EngineCore;
      const timings = yield* UsageResumeTimingSettings;
      const graceMs = Duration.toMillis(timings.grace);
      const retryMs = Duration.toMillis(timings.retry);
      const triedAt = yield* Ref.make<ReadonlyMap<string, number>>(new Map());

      const resolveDueAt = (tried: ReadonlyMap<string, number>, wait: UsageWait) => {
        const first = wait.resetAt + graceMs;
        const at = tried.get(wait.id);
        return at === undefined ? first : Math.max(first, at + retryMs);
      };

      const resolveAttemptId = (taskId: string, wait: UsageWait, now: number) => {
        const id = resolveResumeCommandId(taskId, wait);
        const attempt = Math.floor((now - wait.resetAt - graceMs) / retryMs) + 1;
        return attempt === 1 ? id : `${id}:${attempt}`;
      };

      const resume = Effect.fn('UsageResume.resume')(function* (taskId: string, wait: UsageWait) {
        const now = yield* Clock.currentTimeMillis;
        yield* Ref.update(triedAt, (all) => new Map(all).set(wait.id, now));
        yield* engine
          .dispatch(
            { type: 'usage_wait.resume', taskId, waitId: wait.id },
            { id: resolveAttemptId(taskId, wait, now) }
          )
          .pipe(
            Effect.catch((failure) =>
              Effect.logWarning('[Accounts] Could not resume a task after the usage limit reset').pipe(
                Effect.annotateLogs({ taskId, error: describeError(failure) })
              )
            )
          );
      });

      const list = Effect.gen(function* () {
        const state = yield* engine.state;
        const tried = yield* Ref.get(triedAt);
        const ticks = Object.values(state.tasks).flatMap((task) => {
          const wait = task.usageWait;
          if (wait?.status !== 'armed') return [];
          return [{ id: wait.id, dueAt: resolveDueAt(tried, wait), fire: resume(task.id, wait) }];
        });
        const live = new Set(ticks.map((tick) => tick.id));
        yield* Ref.update(triedAt, (all) => new Map([...all].filter(([id]) => live.has(id))));
        return ticks;
      });

      const clock = yield* makeStateClock({
        now: Clock.currentTimeMillis,
        minDelay: RESUME_MIN_DELAY,
        maxDelay: MAX_CLOCK_DELAY,
        list,
        report: constant(Effect.void),
      });
      const runFork = Effect.runForkWith(yield* Effect.context<never>());
      yield* engine.observe(() => {
        runFork(clock.arm);
      });
      yield* Effect.addFinalizer(() => clock.stop);

      return UsageResume.of({ start: clock.start, stop: clock.stop, fireDue: clock.fireDue });
    })
  );
}
