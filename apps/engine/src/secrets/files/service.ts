import { randomBytes } from 'node:crypto';
import { Context, Effect, Layer, Option, Schema } from 'effect';
import { JsonFile } from '../../files/service.ts';
import { NO_SALT, SALT_BYTES, type SecretFile, SecretFileFields } from '../schema.ts';

export class SecretFiles extends Context.Service<
  SecretFiles,
  {
    read(path: string): Effect.Effect<SecretFile>;
    write(path: string, file: SecretFile): Effect.Effect<void>;
  }
>()('shinsa/engine/secrets/files/SecretFiles') {
  static readonly layer = Layer.effect(
    SecretFiles,
    Effect.gen(function* () {
      const files = yield* JsonFile;
      const decodeFile = Schema.decodeUnknownOption(SecretFileFields);

      const createFile = Effect.sync((): SecretFile => ({
        version: 1,
        salt: randomBytes(SALT_BYTES).toString('hex'),
        refs: {},
        hooks: {},
        mcp: {},
        github: {},
      }));

      const replaceUnreadable = Effect.fn('SecretFiles.replaceUnreadable')(function* (
        path: string,
        problem: string
      ) {
        const copy = yield* files.keepAside(path).pipe(Effect.orDie);
        yield* Effect.logWarning(
          '[Secrets] The secret store could not be read; it was kept aside and an empty one started'
        ).pipe(Effect.annotateLogs({ path, copy, problem }));
        return yield* createFile;
      });

      const read = Effect.fn('SecretFiles.read')(function* (path: string) {
        const stored = yield* Effect.result(files.read(path, Schema.Unknown));
        if (stored._tag === 'Failure') return yield* replaceUnreadable(path, stored.failure.reason);
        if (Option.isNone(stored.success)) return yield* createFile;
        const decoded = decodeFile(stored.success.value);
        if (Option.isNone(decoded)) return yield* replaceUnreadable(path, NO_SALT);
        const fields = decoded.value;
        return {
          version: 1,
          salt: fields.salt,
          refs: fields.refs ?? {},
          hooks: Object.fromEntries(
            Object.entries(fields.hooks ?? {}).map(([id, hook]) => [
              id,
              { token: hook.token, secret: hook.secret ?? null },
            ])
          ),
          mcp: fields.mcp ?? {},
          github: fields.github ?? {},
        } satisfies SecretFile;
      });

      const write = Effect.fn('SecretFiles.write')(function* (path: string, file: SecretFile) {
        yield* files.write(path, file).pipe(Effect.orDie);
      });

      return SecretFiles.of({ read, write });
    })
  );
}
