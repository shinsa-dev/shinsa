import { RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { Slack } from '../../../slack/service.ts';
import {
  SLACK_ENGINE_EVENTS_PATH,
  SLACK_ENGINE_INTERACTIONS_PATH,
  TUNNEL_HEALTH,
  TUNNEL_HEALTH_PATH,
} from './schema.ts';

export const TunnelRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const slack = Option.getOrUndefined(yield* Effect.serviceOption(Slack));

    const respondHealth = Effect.succeed(HttpServerResponse.jsonUnsafe(TUNNEL_HEALTH));

    const respondSlack = Effect.gen(function* () {
      if (!slack) return yield* new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE });
      const request = yield* HttpServerRequest.HttpServerRequest;
      const web = yield* Effect.orDie(HttpServerRequest.toWeb(request));
      const answer = yield* Effect.orDie(slack.handleTunnel(web, new URL(request.originalUrl)));
      return HttpServerResponse.raw(answer);
    });

    return HttpRouter.addAll([
      HttpRouter.route('GET', TUNNEL_HEALTH_PATH, respondHealth),
      HttpRouter.route('POST', SLACK_ENGINE_EVENTS_PATH, respondSlack),
      HttpRouter.route('POST', SLACK_ENGINE_INTERACTIONS_PATH, respondSlack),
    ]);
  })
);
