import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Clock, Context, Effect, Layer, Option, Schema } from 'effect';
import { describeError } from '../log/redact.ts';
import { JSON_FILE_MODE, JSON_INDENT, JsonFileUnreadable, JsonFileWriteFailed, JsonText } from './schema.ts';

export class JsonFile extends Context.Service<
  JsonFile,
  {
    read<A>(path: string, schema: Schema.Decoder<A>): Effect.Effect<Option.Option<A>, JsonFileUnreadable>;
    keepAside(path: string): Effect.Effect<string, JsonFileWriteFailed>;
    write(path: string, value: unknown): Effect.Effect<void, JsonFileWriteFailed>;
  }
>()('shinsa/engine/files/JsonFile') {
  static readonly layer = Layer.sync(JsonFile, () => {
    const decodeText = Schema.decodeUnknownEffect(JsonText);

    const read = Effect.fn('JsonFile.read')(function* <A>(path: string, schema: Schema.Decoder<A>) {
      const present = yield* Effect.sync(() => existsSync(path));
      if (!present) return Option.none<A>();
      const text = yield* Effect.try({
        try: () => readFileSync(path, 'utf8'),
        catch: (error) => new JsonFileUnreadable({ path, reason: describeError(error) }),
      });
      const value = yield* decodeText(text).pipe(
        Effect.mapError((error) => new JsonFileUnreadable({ path, reason: error.message }))
      );
      const decoded = yield* Schema.decodeUnknownEffect(schema)(value).pipe(
        Effect.mapError((error) => new JsonFileUnreadable({ path, reason: error.message }))
      );
      return Option.some(decoded);
    });

    const keepAside = Effect.fn('JsonFile.keepAside')(function* (path: string) {
      const copy = `${path}.unreadable-${yield* Clock.currentTimeMillis}`;
      yield* Effect.try({
        try: () => copyFileSync(path, copy),
        catch: (error) => new JsonFileWriteFailed({ path: copy, message: describeError(error) }),
      });
      return copy;
    });

    const write = Effect.fn('JsonFile.write')(function* (path: string, value: unknown) {
      const staging = `${path}.writing-${process.pid}`;
      yield* Effect.try({
        try: () => {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(staging, `${JSON.stringify(value, null, JSON_INDENT)}\n`, { mode: JSON_FILE_MODE });
          renameSync(staging, path);
        },
        catch: (error) => new JsonFileWriteFailed({ path, message: describeError(error) }),
      });
    });

    return JsonFile.of({ read, keepAside, write });
  });
}
