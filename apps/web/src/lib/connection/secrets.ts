import { Effect } from 'effect';
import { runApp } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';

const answer = Effect.fn('Secrets.answer')(function* (
  gateId: string,
  payload: { readonly value: string } | { readonly decline: true }
) {
  const engine = yield* EngineClient;
  return yield* engine.secrets.answer({ params: { gateId }, payload });
});

export function requestSecretAnswer(gateId: string, payload: { value: string } | { decline: true }) {
  return runApp(answer(gateId, payload));
}
