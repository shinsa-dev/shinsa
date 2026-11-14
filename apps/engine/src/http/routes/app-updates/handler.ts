import { EngineApi } from '@shinsa/core/engine-api';
import { ROUTE_NOT_FOUND_MESSAGE, RouteNotFound } from '@shinsa/core/engine-api/schema';
import { Effect, Option } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { AppUpdates } from '../../../app-updates/service.ts';
import { resolveRequestFailure } from '../../failures.ts';

export const AppUpdatesHandlers = HttpApiBuilder.group(
  EngineApi,
  'appUpdates',
  Effect.fn('AppUpdatesHandlers')(function* (handlers) {
    const given = Option.getOrUndefined(yield* Effect.serviceOption(AppUpdates));
    const updates = given
      ? Effect.succeed(given)
      : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));

    return handlers
      .handle('report', ({ payload }) => Effect.flatMap(updates, (found) => found.report(payload)))
      .handle('view', () => Effect.flatMap(updates, (found) => found.view))
      .handle('request', ({ payload }) =>
        Effect.flatMap(updates, (found) => Effect.mapError(found.request(payload), resolveRequestFailure))
      )
      .handle('open', () =>
        Effect.flatMap(updates, (found) => Effect.mapError(found.open, resolveRequestFailure))
      );
  })
);
