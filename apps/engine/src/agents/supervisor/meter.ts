import type { RunUsage, WeeklyReading } from '@shinsa/core';
import { Effect, Fiber } from 'effect';
import type { AgentSessionResult } from '../providers/index.ts';
import type { Turn } from './schema.ts';
import { RunWorld } from './world/service.ts';

export const meter = Effect.fn('RunSupervisor.meter')(function* (
  runId: string,
  sessionId: string | null,
  usage: RunUsage,
  id: string,
  readings: WeeklyReading[] = []
) {
  const world = yield* RunWorld;
  yield* world
    .dispatch(
      { type: 'run.meter', runId, sessionId, usage, ...(readings.length > 0 ? { readings } : {}) },
      { id }
    )
    .pipe(
      Effect.catch((failure) =>
        Effect.logWarning('[Runs] Could not record what a run cost').pipe(
          Effect.annotateLogs({ runId, error: failure.message })
        )
      )
    );
});

export const meterAttempt = Effect.fn('RunSupervisor.meterAttempt')(function* (
  { run, active, provider }: Turn,
  attemptId: string,
  sessionId: string | null,
  result: AgentSessionResult,
  weeklyBefore: Fiber.Fiber<WeeklyReading | null>
) {
  const { leasing } = yield* RunWorld;
  if (result.usage) {
    const before = yield* Fiber.join(weeklyBefore);
    const after = yield* leasing.readWeeklyReading(run.id, active.lease, provider.id, true);
    const readings = [before, after].filter((reading) => reading !== null);
    yield* meter(run.id, sessionId, result.usage, `run.meter:${attemptId}`, readings);
  }
  for (const subagent of result.subagentUsage ?? []) {
    yield* meter(run.id, subagent.sessionId, subagent.usage, `run.meter:${attemptId}:${subagent.sessionId}`);
  }
});
