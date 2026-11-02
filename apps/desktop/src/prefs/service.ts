import { join } from 'node:path';
import { Context, Effect, Layer, Option, Ref, Schema } from 'effect';
import { Files } from '../files/service.ts';
import { DesktopHost } from '../host/service.ts';
import { PREFS_FILE, PrefsFile, type StoredPrefs } from './schema.ts';

export class Prefs extends Context.Service<
  Prefs,
  {
    readonly read: Effect.Effect<StoredPrefs>;
    write(patch: StoredPrefs): Effect.Effect<void>;
  }
>()('shinsa/desktop/prefs/Prefs') {
  static readonly layer = Layer.effect(
    Prefs,
    Effect.gen(function* () {
      const host = yield* DesktopHost;
      const files = yield* Files;
      const path = join(host.userDataPath, PREFS_FILE);
      const decodePrefs = Schema.decodeUnknownOption(PrefsFile);
      const encodePrefs = Schema.encodeEffect(PrefsFile);
      const saved = yield* files.readText(path);
      const stored = yield* Ref.make(
        Option.getOrElse(Option.flatMap(saved, decodePrefs), (): StoredPrefs => ({}))
      );
      const write = Effect.fn('Prefs.write')(function* (patch: StoredPrefs) {
        const next = yield* Ref.updateAndGet(stored, (current) => ({ ...current, ...patch }));
        const text = yield* Effect.orDie(encodePrefs(next));
        yield* files
          .writeText(path, text)
          .pipe(
            Effect.catchTag('FileWriteFailed', (failure) =>
              Effect.logWarning('Could not save the app’s preferences').pipe(
                Effect.annotateLogs({ path: failure.path, error: failure.message })
              )
            )
          );
      });
      return Prefs.of({ read: Ref.get(stored), write });
    })
  );
}
