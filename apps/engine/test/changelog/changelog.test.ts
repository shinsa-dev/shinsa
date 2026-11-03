import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Changelog } from '@shinsa/core';
import { resolveEngineChangelog } from '../../src/changelog/index.ts';

let root = '';

afterEach(() => rmSync(root, { recursive: true, force: true }));

function createCheckout(files: Record<string, string>) {
  root = mkdtempSync(join(tmpdir(), 'shinsa-changelog-'));
  mkdirSync(join(root, '.changes'));
  for (const [name, source] of Object.entries(files)) writeFileSync(join(root, '.changes', name), source);
  return root;
}

const BUILT: Changelog = {
  releases: [
    {
      version: '1.2.0',
      date: '2026-11-03',
      changes: [{ slug: 'faster-diffs', kind: 'fixed', text: 'Large diffs open without freezing.' }],
    },
  ],
};

describe('resolveEngineChangelog', () => {
  test('reads the changelog a build embedded', () => {
    expect(resolveEngineChangelog({ built: JSON.stringify(BUILT), root: null })).toEqual(BUILT);
  });

  test('answers an empty changelog when the embedded one is broken or missing', () => {
    expect(resolveEngineChangelog({ built: '{"releases":[{"version":1}]}', root: null })).toEqual({
      releases: [],
    });
    expect(resolveEngineChangelog({ built: undefined, root: null })).toEqual({ releases: [] });
  });

  test('reads a checkout’s entries as unreleased, leaving out internal and broken ones', () => {
    const checkout = createCheckout({
      'whats-new.md': '---\nkind: added\n---\nA What’s new button shows what changed.\n',
      'tidy-runner.md': '---\nkind: internal\n---\nThe runner is simpler inside.\n',
      'broken.md': 'no front matter',
      '.gitkeep': '',
    });
    expect(resolveEngineChangelog({ built: undefined, root: checkout })).toEqual({
      releases: [
        {
          version: null,
          date: null,
          changes: [{ slug: 'whats-new', kind: 'added', text: 'A What’s new button shows what changed.' }],
        },
      ],
    });
  });

  test('answers an empty changelog for a checkout without entries', () => {
    root = mkdtempSync(join(tmpdir(), 'shinsa-changelog-'));
    expect(resolveEngineChangelog({ built: undefined, root })).toEqual({ releases: [] });
  });
});
