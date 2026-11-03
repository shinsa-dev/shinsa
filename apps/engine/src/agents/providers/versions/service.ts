import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Effect, Ref } from 'effect';
import { Shell } from '../../../shell/service.ts';
import {
  type CachedVersion,
  type ProgramVersionsHandle,
  UNREADABLE_MODIFIED_AT,
  VERSION_TIMEOUT,
  type VersionParser,
} from './schema.ts';

export const makeProgramVersions = Effect.fn('ProgramVersions.make')(function* () {
  const cache = yield* Ref.make<ReadonlyMap<string, CachedVersion>>(new Map());

  const readModifiedAt = (path: string) =>
    Effect.try({ try: () => statSync(path).mtimeMs, catch: String }).pipe(
      Effect.orElseSucceed(() => UNREADABLE_MODIFIED_AT)
    );

  const read = Effect.fn('ProgramVersions.read')(function* (path: string, parse: VersionParser) {
    const modifiedAt = yield* readModifiedAt(path);
    const cached = (yield* Ref.get(cache)).get(path);
    if (cached && cached.modifiedAt === modifiedAt) return cached.version;
    const shell = yield* Shell;
    const output = yield* shell
      .run({ argv: [path, '--version'], cwd: tmpdir(), timeout: VERSION_TIMEOUT })
      .pipe(
        Effect.catchTag('CommandNotFound', (missing) =>
          Effect.succeed({ stdout: '', stderr: missing.message })
        )
      );
    const version = parse(`${output.stdout}\n${output.stderr}`);
    yield* Ref.update(cache, (seen) => new Map(seen).set(path, { modifiedAt, version }));
    return version;
  });

  const handle: ProgramVersionsHandle = { read };
  return handle;
});
