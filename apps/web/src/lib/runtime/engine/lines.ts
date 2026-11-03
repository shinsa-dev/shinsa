import { Effect, Schema, Stream } from 'effect';
import type { HttpClientResponse } from 'effect/http';
import {
  ENGINE_ANSWER_UNREADABLE_MESSAGE,
  ENGINE_STOPPED_MESSAGE,
  EngineAnswerInvalid,
  EngineStopped,
} from './schema.ts';

export function streamLines<S extends Schema.Decoder<unknown>>(line: S) {
  const decodeLine = Schema.decodeUnknownEffect(Schema.fromJsonString(line));
  const stopped = new EngineStopped({ message: ENGINE_STOPPED_MESSAGE });
  const unreadable = new EngineAnswerInvalid({ message: ENGINE_ANSWER_UNREADABLE_MESSAGE });
  return (response: HttpClientResponse.HttpClientResponse) =>
    response.stream.pipe(
      Stream.mapError(() => stopped),
      Stream.decodeText,
      Stream.splitLines,
      Stream.filter((text) => text.trim() !== ''),
      Stream.mapEffect((text) => Effect.mapError(decodeLine(text), () => unreadable))
    );
}
