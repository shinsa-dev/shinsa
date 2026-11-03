import { Duration, Effect, Scope } from 'effect';
import { describeError } from '../log/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import {
  IDLE_RELEASE,
  type IdleReleaseHandle,
  type IdleReleaseOptions,
  MAX_IDLE_PIN_MS,
} from './idle/schema.ts';
import { makeIdleRelease } from './idle/service.ts';
import type { AgentSession } from './providers/index.ts';

export { IDLE_RELEASE_MS, type IdleReleaseOptions, MAX_IDLE_PIN_MS } from './idle/schema.ts';

type ReleaseHandler = (runId: string, session: AgentSession) => Promise<void>;

export class IdleRelease {
  readonly #handle: IdleReleaseHandle;

  constructor(onRelease: ReleaseHandler, options: IdleReleaseOptions = {}) {
    const now = options.now ?? Date.now;
    this.#handle = edgeRuntime.runSync(
      makeIdleRelease({
        release: (runId, session) =>
          Effect.tryPromise(() => onRelease(runId, session)).pipe(
            Effect.catch((failure) =>
              Effect.logWarning('[Runs] Could not release an idle session').pipe(
                Effect.annotateLogs({ runId, error: describeError(failure.cause) })
              )
            )
          ),
        idle: options.idleMs === undefined ? IDLE_RELEASE : Duration.millis(options.idleMs),
        maxPinMs: options.maxPinMs ?? MAX_IDLE_PIN_MS,
        now: Effect.sync(now),
      }).pipe(Scope.provide(edgeRuntime.runSync(Scope.make())))
    );
  }

  wait(runId: string, session: AgentSession) {
    const end = edgeRuntime.runSync(this.#handle.wait(runId, session));
    return () => {
      edgeRuntime.runSync(end);
    };
  }

  isWaiting(runId: string, session: AgentSession) {
    return edgeRuntime.runSync(this.#handle.isWaiting(runId, session));
  }

  touch(runId: string) {
    edgeRuntime.runSync(this.#handle.touch(runId));
  }

  forget(runId: string) {
    edgeRuntime.runSync(this.#handle.forget(runId));
  }
}
