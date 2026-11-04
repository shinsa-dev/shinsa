import { RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { Extensions } from '../../../extensions/registry/service.ts';
import { SIGN_IN_CALLBACK_PATH, SIGN_IN_PAGE_HEADERS, SIGN_IN_PAGE_TYPE } from './schema.ts';

export const SignInRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const extensions = Option.getOrUndefined(yield* Effect.serviceOption(Extensions));

    const respondCallback = Effect.gen(function* () {
      if (!extensions) return yield* new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE });
      const request = yield* HttpServerRequest.HttpServerRequest;
      const page = yield* extensions.finishSignIn(new URL(request.originalUrl));
      return HttpServerResponse.text(page, { contentType: SIGN_IN_PAGE_TYPE, headers: SIGN_IN_PAGE_HEADERS });
    });

    return HttpRouter.add('GET', SIGN_IN_CALLBACK_PATH, respondCallback);
  })
);
