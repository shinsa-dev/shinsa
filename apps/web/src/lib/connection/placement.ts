import type { PlacementAnswer, PlacementQuestion } from '@shinsa/core';
import { Effect } from 'effect';
import { runApp } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { PlacementUnanswered } from './schema.ts';

const requestAnswer = Effect.fn('Placement.ask')(function* (question: PlacementQuestion) {
  const engine = yield* EngineClient;
  return yield* engine.placement.ask({ payload: { ...question } });
});

export function requestPlacement(question: PlacementQuestion) {
  return runApp(requestAnswer(question));
}

export function requestPlacementAnswer(
  ask: (question: PlacementQuestion) => Promise<{ answer: PlacementAnswer | null }>,
  question: PlacementQuestion
) {
  return runApp(
    Effect.tryPromise({
      try: () => ask(question),
      catch: () => new PlacementUnanswered(),
    }).pipe(
      Effect.map(({ answer }) => ({ answer, failed: false })),
      Effect.catchTag('PlacementUnanswered', () => Effect.succeed({ answer: null, failed: true }))
    )
  );
}
