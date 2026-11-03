import { describe, expect, it } from 'bun:test';
import {
  isEntryPath,
  listReleaseEntries,
  MISSING_ENTRY_MESSAGE,
  needsChangelogEntry,
  resolveChangelogCheck,
  selectEntrySlug,
  serializeReleaseBody,
} from './changelog-rules.ts';

const FIX = {
  slug: 'faster-diffs',
  kind: 'fixed',
  text: 'Large diffs open without freezing the review.',
} as const;

const ADDED = { slug: 'whats-new', kind: 'added', text: 'A What’s new button shows what changed.' } as const;

describe('entry paths', () => {
  it('reads the slug of a Markdown file directly in .changes', () => {
    expect(selectEntrySlug('.changes/faster-diffs.md')).toBe('faster-diffs');
    expect(isEntryPath('.changes/faster-diffs.md')).toBe(true);
    for (const path of [
      '.changes/notes.txt',
      '.changes/nested/entry.md',
      'docs/changes/entry.md',
      'changes/a.md',
    ])
      expect(isEntryPath(path)).toBe(false);
  });
});

describe('resolveChangelogCheck', () => {
  it('accepts valid entries and names each file with its errors', () => {
    expect(
      resolveChangelogCheck([
        {
          path: '.changes/faster-diffs.md',
          source: '---\nkind: fixed\n---\nLarge diffs open without freezing the review.\n',
        },
      ])
    ).toEqual({ ok: true, entries: [FIX] });

    const check = resolveChangelogCheck([
      { path: '.changes/faster-diffs.md', source: '---\nkind: fixed\n---\nFine.\n' },
      { path: '.changes/broken.md', source: '---\nkind: changed\n---\nWrong kind.\n' },
      { path: '.changes/notes.txt', source: '---\nkind: fixed\n---\nNot Markdown.\n' },
    ]);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.errors.some((error) => error.startsWith('.changes/broken.md: '))).toBe(true);
    expect(check.errors).toContain(
      '.changes/notes.txt: The file name must be lowercase words joined by hyphens, ending in .md.'
    );
    expect(check.errors.some((error) => error.startsWith('.changes/faster-diffs.md'))).toBe(false);
  });
});

describe('needsChangelogEntry', () => {
  it('asks for an entry when the app changed and no entry was added', () => {
    expect(needsChangelogEntry(['apps/web/src/main.tsx'], [])).toBe(true);
    expect(needsChangelogEntry(['apps/web/src/main.tsx', '.changes/x.md'], ['.changes/x.md'])).toBe(false);
    expect(MISSING_ENTRY_MESSAGE).toContain('.changes/short-name.md');
  });

  it('asks nothing of a change to docs, notes or entries alone', () => {
    expect(needsChangelogEntry(['docs/release.md', 'CLAUDE.md', '.changes/typo.md'], [])).toBe(false);
    expect(needsChangelogEntry([], [])).toBe(false);
  });

  it('does not count an added file outside .changes as an entry', () => {
    expect(needsChangelogEntry(['apps/web/src/new.ts'], ['apps/web/src/new.ts'])).toBe(true);
  });
});

describe('release notes', () => {
  it('lists only the entries the previous release did not have', () => {
    expect(listReleaseEntries([FIX, ADDED], ['faster-diffs'])).toEqual([ADDED]);
    expect(listReleaseEntries([FIX, ADDED], [])).toEqual([FIX, ADDED]);
  });

  it('puts the channel note above the entries, grouped by kind', () => {
    expect(serializeReleaseBody('**Stable release.**', [FIX, ADDED])).toBe(
      `**Stable release.**\n\n### New\n\n- ${ADDED.text}\n\n### Fixed\n\n- ${FIX.text}\n`
    );
  });

  it('keeps only the channel note when nothing changed', () => {
    expect(serializeReleaseBody('**Canary build of main.**', [])).toBe('**Canary build of main.**\n');
  });
});
