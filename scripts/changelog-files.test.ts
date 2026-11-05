import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BunServices } from '@effect/platform-bun';
import { Effect } from 'effect';
import { listChangeFiles } from './changelog-files.ts';

function readChangeFiles(folder: string) {
  return Effect.runPromise(listChangeFiles(folder).pipe(Effect.provide(BunServices.layer)));
}

let root = '';

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('listChangeFiles', () => {
  it('reads every file in .changes, hidden ones too, in name order, and no folder in it', async () => {
    root = mkdtempSync(join(tmpdir(), 'shinsa-changes-'));
    mkdirSync(join(root, '.changes'));
    writeFileSync(join(root, '.changes/b-entry.md'), 'b');
    writeFileSync(join(root, '.changes/a-entry.md'), 'a');
    writeFileSync(join(root, '.changes/.hidden'), 'h');
    mkdirSync(join(root, '.changes/drafts'));
    expect(await readChangeFiles(root)).toEqual([
      { path: '.changes/.hidden', source: 'h' },
      { path: '.changes/a-entry.md', source: 'a' },
      { path: '.changes/b-entry.md', source: 'b' },
    ]);
  });

  it('finds nothing where there is no .changes folder', async () => {
    root = mkdtempSync(join(tmpdir(), 'shinsa-changes-'));
    expect(await readChangeFiles(root)).toEqual([]);
  });
});
