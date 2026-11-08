import { join } from 'node:path';
import { CHANGES_DIRECTORY, parseChangeEntry, resolveChangelog, resolvePublicChangelog } from '@shinsa/core';
import { Effect, FileSystem, Option, Schema } from 'effect';
import { BuiltChangelog, type ChangelogSource, EMPTY_CHANGELOG } from './schema.ts';

const decodeBuiltChangelog = Schema.decodeUnknownOption(BuiltChangelog);

export const resolveEngineChangelog = Effect.fn('Changelog.resolveEngineChangelog')(function* ({
  built,
  root,
}: ChangelogSource) {
  if (built !== undefined) return Option.getOrElse(decodeBuiltChangelog(built), () => EMPTY_CHANGELOG);
  if (root === null) return EMPTY_CHANGELOG;
  const fs = yield* FileSystem.FileSystem;
  const directory = join(root, CHANGES_DIRECTORY);
  const names = yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed((): string[] => []));
  const changes = yield* Effect.forEach(
    names.filter((name) => name.endsWith('.md')),
    (name) =>
      Effect.map(fs.readFileString(join(directory, name)), (text) =>
        parseChangeEntry(name.slice(0, -'.md'.length), text)
      ).pipe(Effect.option)
  );
  const entries = changes.flatMap((reading) =>
    Option.isSome(reading) && reading.value.ok
      ? [{ version: null, date: null, entry: reading.value.entry }]
      : []
  );
  return resolvePublicChangelog(resolveChangelog(entries));
});
