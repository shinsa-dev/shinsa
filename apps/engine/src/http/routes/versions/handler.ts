import type { UpdateStreamLine } from '@shinsa/core';
import { EngineApi } from '@shinsa/core/engine-api';
import { RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect, Option, Queue, Stream } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { Versions } from '../../../versions/service.ts';
import { resolveRequestFailure } from '../../failures.ts';
import { UPDATE_STREAM_HEADERS, UPDATE_STREAM_TYPE } from './schema.ts';

export const VersionsHandlers = HttpApiBuilder.group(
  EngineApi,
  'versions',
  Effect.fn('VersionsHandlers')(function* (handlers) {
    const given = Option.getOrUndefined(yield* Effect.serviceOption(Versions));
    const versions = given
      ? Effect.succeed(given)
      : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));

    return handlers
      .handle('snapshot', () =>
        Effect.flatMap(versions, (found) => Effect.mapError(found.snapshot, resolveRequestFailure))
      )
      .handle('refresh', () =>
        Effect.flatMap(versions, (found) => Effect.mapError(found.refresh, resolveRequestFailure))
      )
      .handle(
        'update',
        Effect.fn('VersionsHandlers.update')(function* ({ payload, request }) {
          const found = yield* versions;
          const run = yield* found.startUpdate(payload.program).pipe(Effect.mapError(resolveRequestFailure));
          if (!request.headers.accept?.includes(UPDATE_STREAM_TYPE))
            return yield* run(() => undefined).pipe(Effect.mapError(resolveRequestFailure));
          const lines = Stream.callback<UpdateStreamLine, ReturnType<typeof resolveRequestFailure>>((queue) =>
            run((line) => Queue.offerUnsafe(queue, { type: 'output', line })).pipe(
              Effect.mapError(resolveRequestFailure),
              Effect.tap((outcome) => Queue.offer(queue, { type: 'done', ...outcome })),
              Effect.tapError((failure) =>
                Effect.logWarning('[Versions] The update stream failed').pipe(
                  Effect.annotateLogs({ error: failure.message })
                )
              ),
              Effect.flatMap(() => Queue.end(queue)),
              Effect.catch((failure) => Queue.fail(queue, failure))
            )
          );
          return HttpServerResponse.stream(
            lines.pipe(
              Stream.map((line) => `${JSON.stringify(line)}\n`),
              Stream.encodeText
            ),
            { contentType: UPDATE_STREAM_TYPE, headers: UPDATE_STREAM_HEADERS }
          );
        })
      );
  })
);
