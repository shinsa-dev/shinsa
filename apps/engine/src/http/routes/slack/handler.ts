import { EngineApi } from '@shinsa/core/engine-api';
import { RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect, Option } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { Slack } from '../../../slack/service.ts';
import { resolveRequestFailure } from '../../failures.ts';

export const SlackHandlers = HttpApiBuilder.group(
  EngineApi,
  'slack',
  Effect.fn('SlackHandlers')(function* (handlers) {
    const given = Option.getOrUndefined(yield* Effect.serviceOption(Slack));
    const slack = given
      ? Effect.succeed(given)
      : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));

    return handlers
      .handle('snapshot', () => Effect.flatMap(slack, (found) => found.snapshot))
      .handle('disconnect', () =>
        Effect.flatMap(slack, (found) => Effect.mapError(found.disconnect, resolveRequestFailure))
      );
  })
);
