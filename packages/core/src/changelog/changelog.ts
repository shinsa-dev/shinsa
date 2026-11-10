import { Schema, Option } from 'effect';
import { listIssueMessages } from '../domain/issues.ts';
import { resolveVersionOrder } from '../protocol/engine.ts';
import {
  CHANGE_KIND_TITLE,
  CHANGE_KINDS,
  CHANGE_MESSAGES,
  ChangeEntry,
  type ChangeEntryReading,
  type ChangeGroup,
  type Changelog,
  type ChangelogRelease,
  type ReleasedChange,
} from './schema.ts';

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

const FRONT_MATTER_FIELD = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/;

const decodeChangeEntry = Schema.decodeUnknownResult(ChangeEntry, { errors: 'all' });

export function parseChangeEntry(slug: string, source: string): ChangeEntryReading {
  const match = FRONT_MATTER.exec(source.trimStart());
  if (!match) return { ok: false, errors: [CHANGE_MESSAGES.frontMatter] };

  const fields = new Map<string, string>();
  const errors: string[] = [];
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const field = FRONT_MATTER_FIELD.exec(line.trim());
    if (!field) {
      errors.push(CHANGE_MESSAGES.frontMatter);
      continue;
    }
    const [, key = '', value = ''] = field;
    if (key !== 'kind') errors.push(CHANGE_MESSAGES.unknownField(key));
    fields.set(key, value.trim().replace(/^(['"])(.*)\1$/, '$2'));
  }

  const decoded = decodeChangeEntry({
    slug,
    kind: fields.get('kind'),
    text: (match[2] ?? '').replace(/\s+/g, ' ').trim(),
  });
  if (decoded._tag === 'Failure') errors.push(...listIssueMessages(decoded.failure.issue));
  if (errors.length > 0 || decoded._tag === 'Failure') return { ok: false, errors };
  return { ok: true, entry: decoded.success };
}

function compareChanges(a: ChangeEntry, b: ChangeEntry) {
  const order = CHANGE_KINDS.indexOf(a.kind) - CHANGE_KINDS.indexOf(b.kind);
  if (order !== 0) return order;
  return a.slug.localeCompare(b.slug);
}

function compareReleases(a: ChangelogRelease, b: ChangelogRelease) {
  const { version: older } = a;
  const { version: newer } = b;
  if (older === null) return -1;
  if (newer === null) return 1;
  return Option.getOrElse(resolveVersionOrder(newer, older), () => newer.localeCompare(older));
}

export function resolveChangelog(changes: readonly ReleasedChange[]): Changelog {
  const releases = new Map<
    string | null,
    { version: string | null; date: string | null; changes: ChangeEntry[] }
  >();
  for (const change of changes) {
    const release = releases.get(change.version) ?? { version: change.version, date: null, changes: [] };
    release.date ??= change.date;
    release.changes.push(change.entry);
    releases.set(change.version, release);
  }
  return {
    releases: [...releases.values()]
      .map((release) => ({ ...release, changes: [...release.changes].sort(compareChanges) }))
      .sort(compareReleases),
  };
}

export function resolvePublicChangelog(changelog: Changelog): Changelog {
  return {
    releases: changelog.releases
      .map((release) => ({
        ...release,
        changes: release.changes.filter((change) => change.kind !== 'internal'),
      }))
      .filter((release) => release.changes.length > 0),
  };
}

export function listUnseenReleases(changelog: Changelog, lastSeen: string | null) {
  if (lastSeen === null) return [];
  return changelog.releases.filter(
    (release) =>
      release.version !== null && Option.contains(resolveVersionOrder(release.version, lastSeen), 1)
  );
}

export function listChangeGroups(changes: readonly ChangeEntry[]): ChangeGroup[] {
  return CHANGE_KINDS.map((kind) => ({
    kind,
    title: CHANGE_KIND_TITLE[kind],
    changes: changes.filter((change) => change.kind === kind).sort(compareChanges),
  })).filter((group) => group.changes.length > 0);
}

export function serializeReleaseNotes(changes: readonly ChangeEntry[]) {
  return listChangeGroups(changes)
    .map((group) =>
      [`### ${group.title}`, '', ...group.changes.map((change) => `- ${change.text}`)].join('\n')
    )
    .join('\n\n');
}
