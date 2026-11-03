import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Changelog,
  CHANGES_DIRECTORY,
  parseChangeEntry,
  resolveChangelog,
  resolvePublicChangelog,
} from '@shinsa/core';
import { Option, Schema } from 'effect';
import { BuiltChangelog, type ChangelogSource, EMPTY_CHANGELOG } from './schema.ts';

const decodeBuiltChangelog = Schema.decodeUnknownOption(BuiltChangelog);

export function resolveEngineChangelog({ built, root }: ChangelogSource): Changelog {
  if (built !== undefined) return Option.getOrElse(decodeBuiltChangelog(built), () => EMPTY_CHANGELOG);
  if (root === null) return EMPTY_CHANGELOG;

  const directory = join(root, CHANGES_DIRECTORY);
  if (!existsSync(directory)) return EMPTY_CHANGELOG;
  const changes = readdirSync(directory)
    .filter((name) => name.endsWith('.md'))
    .map((name) =>
      parseChangeEntry(name.slice(0, -'.md'.length), readFileSync(join(directory, name), 'utf8'))
    )
    .flatMap((reading) => (reading.ok ? [{ version: null, date: null, entry: reading.entry }] : []));
  return resolvePublicChangelog(resolveChangelog(changes));
}
