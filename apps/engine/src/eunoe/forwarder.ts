import { Cause, Effect, Exit, Scope } from 'effect';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { ForwarderUnavailable } from './schema.ts';

export type Forwarder = ReturnType<typeof Bun.serve>;

export type ForwarderStart = { ok: true; server: Forwarder } | { ok: false; reason: string };

export function createForwarderScope() {
  const scope = edgeRuntime.runSync(Scope.make());
  return {
    open(serve: () => Forwarder): ForwarderStart {
      const started = edgeRuntime.runSyncExit(
        Effect.acquireRelease(
          Effect.try({
            try: serve,
            catch: (error) => new ForwarderUnavailable({ message: describeError(error) }),
          }),
          (server) => Effect.promise(() => server.stop(true))
        ).pipe(Scope.provide(scope))
      );
      if (Exit.isSuccess(started)) return { ok: true, server: started.value };
      return { ok: false, reason: describeError(Cause.squash(started.cause)) };
    },
    close: () => edgeRuntime.runPromise(Scope.close(scope, Exit.void)),
  };
}
