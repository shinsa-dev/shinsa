import type { ShinsaState } from '@shinsa/core';
import { Effect } from 'effect';
import { describeError } from '../log/index.ts';
import { type ClockEntry, StateClock } from '../runtime/clock.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { Engine } from '../runtime/engine.ts';
import { type UsageResumeClockOptions, UsageResumeFailed, type UsageResumeHandle } from './resume/schema.ts';
import { makeUsageResume } from './resume/service.ts';
import { USAGE_RESUME_GRACE_MS, USAGE_RESUME_RETRY_MS } from './schema.ts';

export { resolveResumeCommandId } from './resume/command.ts';
export type { UsageResumeClockOptions } from './resume/schema.ts';

export class UsageResumeClock extends StateClock {
  readonly #handle: UsageResumeHandle;

  constructor(engine: Engine, options: UsageResumeClockOptions = {}) {
    super(engine, { area: 'Accounts', failure: 'Could not resume a waiting task', minDelayMs: 0 }, options);
    this.#handle = edgeRuntime.runSync(
      makeUsageResume({
        graceMs: options.graceMs ?? USAGE_RESUME_GRACE_MS,
        retryMs: options.retryMs ?? USAGE_RESUME_RETRY_MS,
        now: Effect.sync(() => this.now()),
        dispatch: (command, id) =>
          Effect.tryPromise({
            try: () => engine.dispatch(command, { id }),
            catch: (error) => new UsageResumeFailed({ message: describeError(error) }),
          }).pipe(Effect.asVoid),
      })
    );
  }

  protected listEntries(state: ShinsaState): ClockEntry[] {
    return edgeRuntime.runSync(this.#handle.listEntries(state)).map((entry) => ({
      id: entry.id,
      dueAt: entry.dueAt,
      fire: () => edgeRuntime.runPromise(entry.fire),
    }));
  }
}
