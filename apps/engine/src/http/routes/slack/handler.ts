import { EngineApi } from '@shinsa/core/engine-api';
import { RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { requestPromise } from '../../failures.ts';
import { HttpServices } from '../../services/service.ts';

export const SlackHandlers = HttpApiBuilder.group(
  EngineApi,
  'slack',
  Effect.fn('SlackHandlers')(function* (handlers) {
    const { slack: given } = yield* HttpServices;
    const slack = given
      ? Effect.succeed(given)
      : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));

    return handlers
      .handle('snapshot', () => Effect.flatMap(slack, (found) => requestPromise(() => found.snapshot())))
      .handle('disconnect', () => Effect.flatMap(slack, (found) => requestPromise(() => found.disconnect())));
  })
);
