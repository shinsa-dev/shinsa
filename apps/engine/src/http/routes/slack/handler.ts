import { EngineApi } from '@shinsa/core/engine-api';
import { RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect, Option } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { Remote } from '../../../remote/machine/service.ts';
import { Slack } from '../../../slack/service.ts';
import { resolveRequestFailure } from '../../failures.ts';
import { RequestSource } from '../../schema.ts';

export const SlackHandlers = HttpApiBuilder.group(
  EngineApi,
  'slack',
  Effect.fn('SlackHandlers')(function* (handlers) {
    const given = Option.getOrUndefined(yield* Effect.serviceOption(Slack));
    const slack = given
      ? Effect.succeed(given)
      : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));
    const remote = Option.getOrNull(yield* Effect.serviceOption(Remote));

    const resolveViewer = Effect.fn('SlackHandlers.resolveViewer')(function* () {
      const { via, userId } = yield* RequestSource;
      if (via === 'local' || !remote || !userId || (yield* remote.isOwner(userId))) return null;
      return userId;
    });

    return handlers
      .handle('snapshot', () =>
        Effect.flatMap(slack, (found) => Effect.flatMap(resolveViewer(), found.snapshot))
      )
      .handle('disconnect', () =>
        Effect.flatMap(slack, (found) => Effect.mapError(found.disconnect, resolveRequestFailure))
      )
      .handle('channels', () =>
        Effect.flatMap(slack, (found) =>
          found.channels.pipe(
            Effect.map((channels) => ({ channels })),
            Effect.mapError(resolveRequestFailure)
          )
        )
      );
  })
);
