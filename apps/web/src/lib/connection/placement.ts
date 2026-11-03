import type { PlacementQuestion } from '@shinsa/core';
import { Effect } from 'effect';
import { runApp } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';

const ask = Effect.fn('Placement.ask')(function* (question: PlacementQuestion) {
  const engine = yield* EngineClient;
  return yield* engine.placement.ask({ payload: { ...question } });
});

export function requestPlacement(question: PlacementQuestion) {
  return runApp(ask(question));
}
