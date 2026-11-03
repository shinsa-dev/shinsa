import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listChangeFiles } from './changelog-files.ts';

let root = '';

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('listChangeFiles', () => {
  it('reads every file in .changes, hidden ones too, in name order', () => {
    root = mkdtempSync(join(tmpdir(), 'shinsa-changes-'));
    mkdirSync(join(root, '.changes'));
    writeFileSync(join(root, '.changes/b-entry.md'), 'b');
    writeFileSync(join(root, '.changes/a-entry.md'), 'a');
    writeFileSync(join(root, '.changes/.hidden'), 'h');
    expect(listChangeFiles(root)).toEqual([
      { path: '.changes/.hidden', source: 'h' },
      { path: '.changes/a-entry.md', source: 'a' },
      { path: '.changes/b-entry.md', source: 'b' },
    ]);
  });

  it('finds nothing where there is no .changes folder', () => {
    root = mkdtempSync(join(tmpdir(), 'shinsa-changes-'));
    expect(listChangeFiles(root)).toEqual([]);
  });
});
