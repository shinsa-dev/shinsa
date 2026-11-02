import { parsePlacementQuestion } from '@shinsa/core';
import { EngineApi } from '@shinsa/core/engine-api';
import { RequestFailed, RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { requestPromise } from '../../failures.ts';
import { HttpServices } from '../../services/service.ts';
import { PLACEMENT_INVALID } from './schema.ts';

export const PlacementHandlers = HttpApiBuilder.group(
  EngineApi,
  'placement',
  Effect.fn('PlacementHandlers')(function* (handlers) {
    const { place } = yield* HttpServices;

    return handlers.handle(
      'ask',
      Effect.fn('PlacementHandlers.ask')(function* ({ payload }) {
        if (!place) return yield* new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE });
        const question = parsePlacementQuestion(payload);
        if (!question) return yield* new RequestFailed(PLACEMENT_INVALID);
        return { answer: yield* requestPromise(() => place(question)) };
      })
    );
  })
);
