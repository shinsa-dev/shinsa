import { DomainError } from '@shinsa/core';
import { Effect } from 'effect';
import { edgeRuntime } from '../../runtime/edge.ts';
import type { CodeReadFailed, ObjectReaderStopped } from './schema.ts';
import type { CodeFiles } from './service.ts';

export function runCodeRead<A>(effect: Effect.Effect<A, CodeReadFailed | ObjectReaderStopped, CodeFiles>) {
  return edgeRuntime.runPromise(
    effect.pipe(
      Effect.mapError((error) =>
        error._tag === 'CodeReadFailed'
          ? new DomainError({ code: error.code, message: error.message })
          : error
      )
    )
  );
}
