import { dirname } from 'node:path';
import { Clock, Context, Effect, FileSystem, Layer, Option, Schema, Semaphore } from 'effect';
import { constFalse } from 'effect/Function';
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
  static readonly layer = Layer.effect(
    JsonFile,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const decodeText = Schema.decodeUnknownEffect(JsonText);
      const writers = new Map<string, Semaphore.Semaphore>();
      const selectWriter = (path: string) =>
        Effect.sync(() => {
          const known = writers.get(path);
          if (known) return known;
          const made = Semaphore.makeUnsafe(1);
          writers.set(path, made);
          return made;
        });

      const read = Effect.fn('JsonFile.read')(function* <A>(path: string, schema: Schema.Decoder<A>) {
        const present = yield* fs.exists(path).pipe(Effect.orElseSucceed(constFalse));
        if (!present) return Option.none<A>();
        const text = yield* fs
          .readFileString(path)
          .pipe(Effect.mapError((error) => new JsonFileUnreadable({ path, reason: describeError(error) })));
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
        yield* fs
          .copyFile(path, copy)
          .pipe(
            Effect.mapError((error) => new JsonFileWriteFailed({ path: copy, message: describeError(error) }))
          );
        return copy;
      });

      const write = Effect.fn('JsonFile.write')(function* (path: string, value: unknown) {
        const staging = `${path}.writing-${process.pid}`;
        const writer = yield* selectWriter(path);
        yield* fs.makeDirectory(dirname(path), { recursive: true }).pipe(
          Effect.andThen(
            fs.writeFileString(staging, `${JSON.stringify(value, null, JSON_INDENT)}\n`, {
              mode: JSON_FILE_MODE,
            })
          ),
          Effect.andThen(fs.rename(staging, path)),
          Effect.mapError((error) => new JsonFileWriteFailed({ path, message: describeError(error) })),
          Semaphore.withPermit(writer)
        );
      });

      return JsonFile.of({ read, keepAside, write });
    })
  );
}
