import { serializeEngineFailure } from '@shinsa/core/engine-api/errors';
import { RequestFailed } from '@shinsa/core/engine-api/schema';
import { Effect } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { FIXED_FAILURES, type IngressFailure } from './schema.ts';

export function respondFailure(failure: IngressFailure) {
  if (failure._tag === 'RequestFailed')
    return Effect.succeed(
      HttpServerResponse.jsonUnsafe(serializeEngineFailure(failure), { status: RequestFailed.status })
    );
  const fixed = FIXED_FAILURES[failure._tag];
  return Effect.succeed(
    HttpServerResponse.jsonUnsafe(serializeEngineFailure({ code: fixed.code, message: failure.message }), {
      status: fixed.status,
    })
  );
}
