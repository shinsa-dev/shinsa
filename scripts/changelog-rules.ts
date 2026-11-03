import {
  type ChangeEntry,
  CHANGES_DIRECTORY,
  parseChangeEntry,
  serializeReleaseNotes,
} from '../packages/core/src/changelog/index.ts';
import { isAppChange } from './release-version.ts';

export interface ChangeFile {
  path: string;
  source: string;
}

export type ChangelogCheck = { ok: true; entries: ChangeEntry[] } | { ok: false; errors: string[] };

export const MISSING_ENTRY_MESSAGE = `This branch changes the app but adds no changelog entry. Add a file to ${CHANGES_DIRECTORY}/, such as ${CHANGES_DIRECTORY}/short-name.md, with a line \`---\`, \`kind: added\` (or improved, fixed, internal), \`---\`, then one or two plain sentences on what changed for the person using Shinsa (docs/release.md → The changelog).`;

const ENTRY_PATH = new RegExp(`^${CHANGES_DIRECTORY.replace('.', '\\.')}/([^/]+)\\.md$`);

export function selectEntrySlug(path: string) {
  return ENTRY_PATH.exec(path)?.[1] ?? null;
}

export function isEntryPath(path: string) {
  return selectEntrySlug(path) !== null;
}

export function resolveChangelogCheck(files: readonly ChangeFile[]): ChangelogCheck {
  const entries: ChangeEntry[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const reading = parseChangeEntry(selectEntrySlug(file.path) ?? file.path, file.source);
    if (reading.ok) entries.push(reading.entry);
    else errors.push(...reading.errors.map((error) => `${file.path}: ${error}`));
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, entries };
}

export function needsChangelogEntry(changed: readonly string[], added: readonly string[]) {
  return changed.some(isAppChange) && !added.some(isEntryPath);
}

export function listReleaseEntries(entries: readonly ChangeEntry[], releasedSlugs: readonly string[]) {
  const released = new Set(releasedSlugs);
  return entries.filter((entry) => !released.has(entry.slug));
}

export function serializeReleaseBody(channelNote: string, entries: readonly ChangeEntry[]) {
  const notes = serializeReleaseNotes(entries);
  return notes ? `${channelNote}\n\n${notes}\n` : `${channelNote}\n`;
}
