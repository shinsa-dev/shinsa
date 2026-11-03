import { Effect, Schema } from 'effect';
import { RefName, RefNameInvalid } from './schema.ts';

export const decodeRefName = Effect.fn('Git.decodeRefName')(function* (name: string) {
  return yield* Schema.decodeUnknownEffect(RefName)(name).pipe(
    Effect.mapError(
      () =>
        new RefNameInvalid({ ref: name, message: `"${name}" is not a branch name Shinsa will pass to git.` })
    )
  );
});
