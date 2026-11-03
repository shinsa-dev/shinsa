import { Clock, Duration, Effect, Option, Schedule } from 'effect';
import type { ActiveRun } from '../active/schema.ts';
import type { AgentSessionResult } from '../providers/index.ts';
import { OVERLOAD_RETRIES, OVERLOAD_RETRY, type Turn } from './schema.ts';
import { RunWorld } from './world/service.ts';

export const resolveOverloadDelay = Effect.fn('RunSupervisor.resolveOverloadDelay')(function* (
  attempt: number,
  baseMs: number
) {
  const step = yield* Schedule.toStep(OVERLOAD_RETRY);
  let delay = Option.none<number>();
  for (let index = 0; index < attempt; index += 1) {
    const next = yield* Effect.option(step(0, { baseMs }));
    if (Option.isNone(next)) return Option.none<number>();
    delay = Option.some(Duration.toMillis(next.value[1]));
  }
  return delay;
});

export const isOverloadRetry = Effect.fn('RunSupervisor.isOverloadRetry')(function* (
  active: ActiveRun,
  result: AgentSessionResult,
  shuttingDown: boolean
) {
  if (result.outcome !== 'failed' || result.failure?.class !== 'overloaded') return false;
  if (active.stopping || shuttingDown) return false;
  const { config } = yield* RunWorld;
  return Option.isSome(yield* resolveOverloadDelay(active.overloads + 1, config.overloadRetryMs));
});

const awaitWake = (active: ActiveRun) =>
  Effect.callback<void>((resume) => {
    active.wake = () => {
      active.wake = null;
      resume(Effect.void);
    };
    return Effect.sync(() => {
      active.wake = null;
    });
  });

export const waitForOverload = Effect.fn('RunSupervisor.waitForOverload')(function* (
  { run, active, provider }: Turn,
  detail: string
) {
  const world = yield* RunWorld;
  active.overloads += 1;
  const next = yield* resolveOverloadDelay(active.overloads, world.config.overloadRetryMs);
  if (Option.isNone(next)) return;
  const delay = next.value;
  const now = yield* Clock.currentTimeMillis;
  yield* Effect.logInfo('[Runs] The provider is overloaded; trying the same turn again shortly').pipe(
    Effect.annotateLogs({ runId: run.id, attempt: active.overloads, delayMs: delay })
  );
  yield* world.recordEntry(run.id, {
    type: 'notice',
    notice: {
      kind: 'retrying',
      provider: provider.id,
      detail,
      attempt: active.overloads,
      attempts: OVERLOAD_RETRIES,
      retryAt: now + delay,
    },
  });
  yield* Effect.raceFirst(Effect.sleep(Duration.millis(delay)), awaitWake(active));
});
