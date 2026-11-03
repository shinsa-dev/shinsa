import { describe, expect, test } from 'bun:test';
import {
  CHANGE_MESSAGES,
  type ChangeEntry,
  listChangeGroups,
  listUnseenReleases,
  parseChangeEntry,
  type ReleasedChange,
  resolveChangelog,
  resolvePublicChangelog,
  serializeReleaseNotes,
} from '../../src/index.ts';

function entry(slug: string, kind: ChangeEntry['kind'], text = `${slug} text.`): ChangeEntry {
  return { slug, kind, text };
}

function released(version: string | null, change: ChangeEntry, date: string | null = null): ReleasedChange {
  return { version, date, entry: change };
}

describe('parseChangeEntry', () => {
  test('reads the kind and folds the body into one line', () => {
    const source = '---\nkind: improved\n---\nThe queue loads faster.\nIt also scrolls  smoothly.\n';
    expect(parseChangeEntry('faster-queue', source)).toEqual({
      ok: true,
      entry: {
        slug: 'faster-queue',
        kind: 'improved',
        text: 'The queue loads faster. It also scrolls smoothly.',
      },
    });
  });

  test('accepts a quoted kind, Windows line ends and a byte order mark', () => {
    const source = '﻿---\r\nkind: "fixed"\r\n\r\n---\r\nThe dialog closes.\r\n';
    expect(parseChangeEntry('dialog', source)).toEqual({
      ok: true,
      entry: { slug: 'dialog', kind: 'fixed', text: 'The dialog closes.' },
    });
  });

  test('refuses an entry without front matter', () => {
    expect(parseChangeEntry('plain', 'Just text.')).toEqual({
      ok: false,
      errors: [CHANGE_MESSAGES.frontMatter],
    });
  });

  test('refuses an entry with front matter and no body', () => {
    expect(parseChangeEntry('empty', '---\nkind: added\n---')).toEqual({
      ok: false,
      errors: [CHANGE_MESSAGES.empty],
    });
  });

  test('refuses an unknown kind, an unknown field and a line that is not a field', () => {
    const reading = parseChangeEntry('odd', '---\nkind: changed\nscope: web\nnot a field\n---\nSomething.');
    expect(reading).toEqual({
      ok: false,
      errors: [
        CHANGE_MESSAGES.unknownField('scope'),
        CHANGE_MESSAGES.frontMatter,
        'kind must be one of added, improved, fixed, internal.',
      ],
    });
  });

  test('refuses a missing kind', () => {
    expect(parseChangeEntry('no-kind', '---\n\n---\nSomething.')).toEqual({
      ok: false,
      errors: ['kind must be one of added, improved, fixed, internal.'],
    });
  });

  test('refuses text over the limit and a file name that is not a slug', () => {
    const reading = parseChangeEntry('Bad_Name', `---\nkind: added\n---\n${'a'.repeat(281)}`);
    expect(reading).toEqual({ ok: false, errors: [CHANGE_MESSAGES.slug, CHANGE_MESSAGES.long] });
  });

  test('refuses a field error even when the entry itself decodes', () => {
    expect(parseChangeEntry('extra', '---\nkind: added\nauthor: me\n---\nSomething.')).toEqual({
      ok: false,
      errors: [CHANGE_MESSAGES.unknownField('author')],
    });
  });
});

describe('resolveChangelog', () => {
  test('groups changes by release, newest first, unreleased on top, each sorted by kind', () => {
    const changelog = resolveChangelog([
      released('1.2.0', entry('b-fix', 'fixed'), '2026-10-01'),
      released('1.3.0-canary.2', entry('new-thing', 'added'), '2026-11-01'),
      released('1.2.0', entry('a-new', 'added')),
      released(null, entry('wip', 'improved')),
      released('1.3.0-canary.10', entry('later', 'internal'), '2026-11-02'),
      released('1.2.0', entry('a-fix', 'fixed')),
    ]);
    expect(changelog).toEqual({
      releases: [
        { version: null, date: null, changes: [entry('wip', 'improved')] },
        { version: '1.3.0-canary.10', date: '2026-11-02', changes: [entry('later', 'internal')] },
        { version: '1.3.0-canary.2', date: '2026-11-01', changes: [entry('new-thing', 'added')] },
        {
          version: '1.2.0',
          date: '2026-10-01',
          changes: [entry('a-new', 'added'), entry('a-fix', 'fixed'), entry('b-fix', 'fixed')],
        },
      ],
    });
  });

  test('keeps the unreleased group first whichever side it is compared on', () => {
    const changelog = resolveChangelog([
      released('1.0.0', entry('one', 'added')),
      released(null, entry('two', 'added')),
    ]);
    expect(changelog.releases.map((release) => release.version)).toEqual([null, '1.0.0']);
    const reversed = resolveChangelog([
      released(null, entry('two', 'added')),
      released('1.0.0', entry('one', 'added')),
    ]);
    expect(reversed.releases.map((release) => release.version)).toEqual([null, '1.0.0']);
  });

  test('orders versions it cannot read by name', () => {
    const changelog = resolveChangelog([
      released('nightly-a', entry('a', 'added')),
      released('nightly-b', entry('b', 'added')),
    ]);
    expect(changelog.releases.map((release) => release.version)).toEqual(['nightly-b', 'nightly-a']);
  });
});

describe('resolvePublicChangelog', () => {
  test('drops internal changes and the releases left empty', () => {
    const changelog = resolveChangelog([
      released('1.1.0', entry('refactor', 'internal')),
      released('1.0.0', entry('shown', 'added')),
      released('1.0.0', entry('hidden', 'internal')),
    ]);
    expect(resolvePublicChangelog(changelog)).toEqual({
      releases: [{ version: '1.0.0', date: null, changes: [entry('shown', 'added')] }],
    });
  });
});

describe('listUnseenReleases', () => {
  const changelog = resolveChangelog([
    released(null, entry('wip', 'added')),
    released('1.3.0', entry('three', 'added')),
    released('1.2.0', entry('two', 'added')),
    released('1.1.0', entry('one', 'added')),
  ]);

  test('lists the releases newer than the version last seen', () => {
    expect(listUnseenReleases(changelog, '1.1.0').map((release) => release.version)).toEqual([
      '1.3.0',
      '1.2.0',
    ]);
  });

  test('lists nothing on a fresh install or when everything was seen', () => {
    expect(listUnseenReleases(changelog, null)).toEqual([]);
    expect(listUnseenReleases(changelog, '1.3.0')).toEqual([]);
  });
});

describe('serializeReleaseNotes', () => {
  test('writes a section per kind in a fixed order', () => {
    const notes = serializeReleaseNotes([
      entry('refactor', 'internal', 'The engine moved to Effect.'),
      entry('crash', 'fixed', 'Shinsa no longer stops on a lost connection.'),
      entry('dialog', 'added', 'A What’s new dialog shows what changed.'),
      entry('speed', 'improved', 'The queue loads faster.'),
    ]);
    expect(notes).toBe(
      [
        '### New',
        '',
        '- A What’s new dialog shows what changed.',
        '',
        '### Improved',
        '',
        '- The queue loads faster.',
        '',
        '### Fixed',
        '',
        '- Shinsa no longer stops on a lost connection.',
        '',
        '### Behind the scenes',
        '',
        '- The engine moved to Effect.',
      ].join('\n')
    );
  });

  test('writes nothing for a release without entries', () => {
    expect(serializeReleaseNotes([])).toBe('');
  });
});

describe('listChangeGroups', () => {
  test('titles each kind and leaves out the empty ones', () => {
    expect(listChangeGroups([entry('b', 'fixed'), entry('a', 'fixed')])).toEqual([
      { kind: 'fixed', title: 'Fixed', changes: [entry('a', 'fixed'), entry('b', 'fixed')] },
    ]);
  });
});
