import { Schema } from 'effect';
import { Choice } from '../domain/fields.ts';

export const CHANGES_DIRECTORY = '.changes';

export const CHANGE_KINDS = ['added', 'improved', 'fixed', 'internal'] as const;

export const ChangeKind = Choice(CHANGE_KINDS);

export type ChangeKind = typeof ChangeKind.Type;

export const CHANGE_KIND_TITLE: Record<ChangeKind, string> = {
  added: 'New',
  improved: 'Improved',
  fixed: 'Fixed',
  internal: 'Behind the scenes',
};

export const CHANGE_TEXT_LIMIT = 280;

export const CHANGE_SLUG_LIMIT = 80;

export const CHANGE_MESSAGES = {
  frontMatter: 'The entry must start with its front matter: a line `---`, `kind: <kind>`, then `---`.',
  unknownField: (field: string) => `The front matter has only kind, not ${field}.`,
  slug: 'The file name must be lowercase words joined by hyphens, ending in .md.',
  empty: 'The entry needs one or two plain sentences under its front matter.',
  long: `The entry is longer than ${CHANGE_TEXT_LIMIT} characters. Keep it to one or two plain sentences.`,
} as const;

export const ChangeEntry = Schema.Struct({
  slug: Schema.String.check(
    Schema.isMaxLength(CHANGE_SLUG_LIMIT, { message: CHANGE_MESSAGES.slug }),
    Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: CHANGE_MESSAGES.slug })
  ),
  kind: ChangeKind,
  text: Schema.String.check(
    Schema.isNonEmpty({ message: CHANGE_MESSAGES.empty }),
    Schema.isMaxLength(CHANGE_TEXT_LIMIT, { message: CHANGE_MESSAGES.long })
  ),
});

export type ChangeEntry = typeof ChangeEntry.Type;

export type ChangeEntryReading = { ok: true; entry: ChangeEntry } | { ok: false; errors: string[] };

export const ReleasedChange = Schema.Struct({
  version: Schema.NullOr(Schema.String),
  date: Schema.NullOr(Schema.String),
  entry: ChangeEntry,
});

export type ReleasedChange = typeof ReleasedChange.Type;

export const ChangelogRelease = Schema.Struct({
  version: Schema.NullOr(Schema.String),
  date: Schema.NullOr(Schema.String),
  changes: Schema.Array(ChangeEntry),
});

export type ChangelogRelease = typeof ChangelogRelease.Type;

export const Changelog = Schema.Struct({
  releases: Schema.Array(ChangelogRelease),
});

export type Changelog = typeof Changelog.Type;

export interface ChangeGroup {
  kind: ChangeKind;
  title: string;
  changes: ChangeEntry[];
}
