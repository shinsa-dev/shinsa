import { Effect } from 'effect';
import { runApp } from '@/lib/runtime/app.ts';
import { EngineHttp } from '@/lib/runtime/engine-http/service.ts';
import { ENGINE_ANSWER_UNREADABLE_MESSAGE, EngineAnswerInvalid } from '@/lib/runtime/engine/schema.ts';

const readText = Effect.fn('Evidence.readText')(function* (uri: string) {
  const http = yield* EngineHttp;
  const response = yield* http.get(uri);
  return yield* Effect.mapError(
    response.text,
    () => new EngineAnswerInvalid({ message: ENGINE_ANSWER_UNREADABLE_MESSAGE })
  );
});

export function requestEvidenceBody(uri: string) {
  return runApp(readText(uri));
}
