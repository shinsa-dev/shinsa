import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EVIDENCE_COPY_LIMIT_BYTES,
  EVIDENCE_ROUTE,
  resolveEvidenceFolder,
} from '../../src/store/evidence.ts';
import { EvidenceStore } from '../../src/store/index.ts';
import { createTempDir } from '../helpers/index.ts';

const FOLDER = { taskId: 'task-1', round: 1 };

function nameOf(uri: string) {
  return uri.slice(EVIDENCE_ROUTE.length);
}

describe('EvidenceStore', () => {
  test('chat images stay at the top, attached evidence goes under its task and round', () => {
    const dir = createTempDir();
    const store = new EvidenceStore(dir);
    const image = store.writeImage(Buffer.from('png').toString('base64'), 'image/png');
    const odd = store.writeImage('', 'image/');
    const text = store.writeText('all green', FOLDER, 'Unit tests: all pass!');
    const note = store.writeText('| a | b |', FOLDER, 'Contrast', 'md');
    const source = join(createTempDir(), 'Screen Shot.PNG');
    writeFileSync(source, 'shot');
    const copied = store.copyFile(source, { taskId: 'task-1', round: 3 }, '---');
    const bare = join(createTempDir(), 'LOG');
    writeFileSync(bare, 'log');
    expect(image).toMatch(/^\/api\/evidence\/\w+\.png$/);
    expect(odd.endsWith('.png')).toBe(true);
    expect(text).toMatch(/^\/api\/evidence\/task-1\/round-1\/unit-tests-all-pass-\w+\.txt$/);
    expect(note).toMatch(/^\/api\/evidence\/task-1\/round-1\/contrast-\w+\.md$/);
    expect(copied).toMatch(/^\/api\/evidence\/task-1\/round-3\/evidence-\w+\.png$/);
    expect(store.copyFile(bare, FOLDER, 'Log').endsWith('.bin')).toBe(true);
    expect(readFileSync(join(dir, nameOf(text)), 'utf8')).toBe('all green');
    expect(readFileSync(join(dir, nameOf(copied)), 'utf8')).toBe('shot');
    expect(store.selectFile(nameOf(copied))).toBe(join(dir, nameOf(copied)));
  });

  test('copying something that is not a file, or too large, is refused', () => {
    const store = new EvidenceStore(createTempDir());
    const folder = createTempDir();
    expect(() => store.copyFile(join(folder, 'missing.png'), FOLDER, 'x')).toThrow('No file at');
    expect(() => store.copyFile(folder, FOLDER, 'x')).toThrow('No file at');
    const huge = join(folder, 'huge.webm');
    writeFileSync(huge, '');
    truncateSync(huge, EVIDENCE_COPY_LIMIT_BYTES + 1);
    expect(() => store.copyFile(huge, FOLDER, 'x')).toThrow('is 201 MB; the limit is 200 MB.');
  });

  test('a task id that cannot name a folder is refused', () => {
    expect(resolveEvidenceFolder({ taskId: 'abc', round: 2 })).toBe('abc/round-2');
    expect(() => resolveEvidenceFolder({ taskId: '../x', round: 1 })).toThrow(
      'cannot name an evidence folder'
    );
  });

  test('only plain names, or a task, a round and a name, resolve inside the evidence directory', () => {
    const dir = createTempDir();
    mkdirSync(join(dir, 'nested'));
    mkdirSync(join(dir, 'task-1', 'round-1', 'deep'), { recursive: true });
    writeFileSync(join(dir, 'seed-image-1.png'), 'x');
    writeFileSync(join(dir, 'nested', 'x'), 'x');
    writeFileSync(join(dir, 'task-1', 'round-1', 'shot.png'), 'x');
    const store = new EvidenceStore(dir);
    expect(store.selectFile('seed-image-1.png')).toBe(join(dir, 'seed-image-1.png'));
    expect(store.selectFile('task-1/round-1/shot.png')).toBe(join(dir, 'task-1', 'round-1', 'shot.png'));
    expect(store.selectFile('missing.png')).toBeNull();
    for (const name of [
      '..',
      '.hidden',
      '..shinsa.sqlite',
      'a..b',
      'nested/x',
      'task-1/round-1/deep',
      'task-1/other/shot.png',
      'task-1/round-1/../shot.png',
      'a/round-1/b/c',
      '',
    ]) {
      expect(store.selectFile(name)).toBeNull();
    }
  });

  test('reads back stored text by its address, never a large file or one outside the store', () => {
    const dir = createTempDir();
    const store = new EvidenceStore(dir);
    const text = store.writeText('4 pass', FOLDER, 'Tests');
    const large = store.writeText('', FOLDER, 'Large');
    truncateSync(join(dir, nameOf(large)), 1024 * 1024 + 1);
    expect(store.selectText(text)).toBe('4 pass');
    expect(store.selectText(large)).toBeNull();
    expect(store.selectText(`${EVIDENCE_ROUTE}task-1/round-1/missing.txt`)).toBeNull();
    expect(store.selectText('https://example.com/out.txt')).toBeNull();
  });
});
