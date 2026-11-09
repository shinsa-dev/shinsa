import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRange } from '../../../src/agents/transcripts/file.ts';

describe('reading a range of a transcript', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shinsa-transcript-'));

  test('the bytes between the two offsets come back', () => {
    const path = join(dir, 'run.jsonl');
    writeFileSync(path, 'abcdef');
    expect(readRange(path, 2, 5).toString()).toBe('cde');
  });

  test('a file it cannot open or read gives no bytes instead of a throw', () => {
    expect(readRange(join(dir, 'missing.jsonl'), 0, 4).length).toBe(0);
    expect(readRange(dir, 0, 4).length).toBe(0);
  });
});
