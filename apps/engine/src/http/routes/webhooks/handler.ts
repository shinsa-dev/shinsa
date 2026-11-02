import { RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { HttpServices } from '../../services/service.ts';
import { WEBHOOK_ROUTE } from './schema.ts';

export const WebhookRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const { schedules } = yield* HttpServices;

    const respondHook = Effect.gen(function* () {
      if (!schedules) return yield* new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE });
      const request = yield* HttpServerRequest.HttpServerRequest;
      const web = yield* Effect.orDie(HttpServerRequest.toWeb(request));
      const answer = yield* Effect.promise(() => schedules.handleWebhook(web, new URL(request.originalUrl)));
      return HttpServerResponse.raw(answer);
    });

    return HttpRouter.add('*', WEBHOOK_ROUTE, respondHook);
  })
);
