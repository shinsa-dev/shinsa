import type { ShinsaState, UsageWait } from '@shinsa/core';
import { Effect, Ref } from 'effect';
import { resolveResumeCommandId } from './command.ts';
import type { UsageResumeDefinition, UsageResumeEntry, UsageResumeHandle } from './schema.ts';

export const makeUsageResume = Effect.fn('UsageResume.make')(function* (definition: UsageResumeDefinition) {
  const triedAt = yield* Ref.make<ReadonlyMap<string, number>>(new Map());

  const resolveDueAt = (tried: ReadonlyMap<string, number>, wait: UsageWait) => {
    const first = wait.resetAt + definition.graceMs;
    const at = tried.get(wait.id);
    return at === undefined ? first : Math.max(first, at + definition.retryMs);
  };

  const resolveAttemptId = (taskId: string, wait: UsageWait, now: number) => {
    const id = resolveResumeCommandId(taskId, wait);
    const attempt = Math.floor((now - wait.resetAt - definition.graceMs) / definition.retryMs) + 1;
    return attempt === 1 ? id : `${id}:${attempt}`;
  };

  const resume = Effect.fn('UsageResume.resume')(function* (taskId: string, wait: UsageWait) {
    const now = yield* definition.now;
    yield* Ref.update(triedAt, (all) => new Map(all).set(wait.id, now));
    yield* definition
      .dispatch({ type: 'usage_wait.resume', taskId, waitId: wait.id }, resolveAttemptId(taskId, wait, now))
      .pipe(
        Effect.catch((failure) =>
          Effect.logWarning('[Accounts] Could not resume a task after the usage limit reset').pipe(
            Effect.annotateLogs({ taskId, error: failure.message })
          )
        )
      );
  });

  const listEntries = Effect.fn('UsageResume.listEntries')(function* (state: ShinsaState) {
    const tried = yield* Ref.get(triedAt);
    const entries = Object.values(state.tasks).flatMap((task): UsageResumeEntry[] => {
      const wait = task.usageWait;
      if (wait?.status !== 'armed') return [];
      return [{ id: wait.id, dueAt: resolveDueAt(tried, wait), fire: resume(task.id, wait) }];
    });
    const live = new Set(entries.map((entry) => entry.id));
    yield* Ref.update(triedAt, (all) => new Map([...all].filter(([id]) => live.has(id))));
    return entries;
  });

  const handle: UsageResumeHandle = { listEntries };
  return handle;
});
