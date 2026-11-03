import { Effect, Schema } from 'effect';
import { ENGINE_ANSWER_UNREADABLE_MESSAGE, EngineAnswerInvalid } from './schema.ts';

export function decodeAnswer<S extends Schema.Decoder<unknown>>(schema: S) {
  const decode = Schema.decodeUnknownEffect(schema);
  return (value: unknown) =>
    Effect.mapError(
      decode(value),
      () => new EngineAnswerInvalid({ message: ENGINE_ANSWER_UNREADABLE_MESSAGE })
    );
}
