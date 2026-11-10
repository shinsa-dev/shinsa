import { DomainError } from '@shinsa/core';
import { RequestFailed } from '@shinsa/core/engine-api/schema';
import { Effect, type Result, Schema } from 'effect';
import { describeError } from '../log/index.ts';
import { REQUEST_FAILED } from './schema.ts';

const isDomainError = Schema.is(DomainError);

export function resolveRequestFailure(error: unknown) {
  return new RequestFailed({
    code: isDomainError(error) ? error.code : REQUEST_FAILED,
    message: describeError(error),
  });
}

export function requestResult<A, E>(result: Result.Result<A, E>) {
  return Effect.mapError(Effect.fromResult(result), resolveRequestFailure);
}
