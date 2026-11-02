import { Duration, Effect } from 'effect';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { ClassifierFailed } from './schema.ts';

export function requestWithin<A>(ask: () => Promise<A>, timeoutMs: number) {
  return edgeRuntime.runPromise(
    Effect.tryPromise({
      try: ask,
      catch: (cause) => new ClassifierFailed({ message: describeError(cause) }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(timeoutMs),
        orElse: () =>
          Effect.fail(
            new ClassifierFailed({ message: `The classifier did not answer within ${timeoutMs} ms.` })
          ),
      })
    )
  );
}
