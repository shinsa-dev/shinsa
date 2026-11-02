import type { UpdateStreamLine } from '@shinsa/core';
import { EngineApi } from '@shinsa/core/engine-api';
import { RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect, Queue, Stream } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { requestPromise, requestSync, resolveRequestFailure } from '../../failures.ts';
import { HttpServices } from '../../services/service.ts';
import { UPDATE_STREAM_HEADERS, UPDATE_STREAM_TYPE } from './schema.ts';

export const VersionsHandlers = HttpApiBuilder.group(
  EngineApi,
  'versions',
  Effect.fn('VersionsHandlers')(function* (handlers) {
    const { versions: given } = yield* HttpServices;
    const versions = given
      ? Effect.succeed(given)
      : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));

    return handlers
      .handle('snapshot', () => Effect.flatMap(versions, (found) => requestPromise(() => found.snapshot())))
      .handle('refresh', () => Effect.flatMap(versions, (found) => requestPromise(() => found.refresh())))
      .handle(
        'update',
        Effect.fn('VersionsHandlers.update')(function* ({ payload, request }) {
          const found = yield* versions;
          const run = yield* requestSync(() => found.startUpdate(payload.program));
          if (!request.headers.accept?.includes(UPDATE_STREAM_TYPE))
            return yield* requestPromise(() => run(() => undefined));
          const lines = Stream.callback<UpdateStreamLine, ReturnType<typeof resolveRequestFailure>>((queue) =>
            requestPromise(() => run((line) => Queue.offerUnsafe(queue, { type: 'output', line }))).pipe(
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
