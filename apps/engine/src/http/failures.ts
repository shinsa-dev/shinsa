import { DomainError } from '@shinsa/core';
import { RequestFailed } from '@shinsa/core/engine-api/schema';
import { Effect, Schema } from 'effect';
import { describeError } from '../log/index.ts';
import { REQUEST_FAILED } from './schema.ts';

const isDomainError = Schema.is(DomainError);

export function resolveRequestFailure(error: unknown) {
  return new RequestFailed({
    code: isDomainError(error) ? error.code : REQUEST_FAILED,
    message: describeError(error),
  });
}

export function requestSync<A>(run: () => A) {
  return Effect.try({ try: run, catch: resolveRequestFailure });
}
