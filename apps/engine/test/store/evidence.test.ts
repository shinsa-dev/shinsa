import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Option } from 'effect';
import { resolveFolderPath } from '../../src/store/evidence/folder.ts';
import { EVIDENCE_COPY_LIMIT_BYTES, EVIDENCE_ROUTE } from '../../src/store/evidence/index.ts';
import { createTestEvidence } from '../helpers/evidence.ts';
import { createTempDir } from '../helpers/index.ts';

const FOLDER = { taskId: 'task-1', round: 1 };

function openStore(dir: string) {
  const evidence = createTestEvidence(dir);
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
  return {
    writeImage: (base64: string, mediaType: string) => run(evidence.writeImage(base64, mediaType)),
    writeText: (text: string, folder: typeof FOLDER, title: string, extension: 'txt' | 'md' = 'txt') =>
      run(evidence.writeText(text, folder, title, extension)),
    copyFile: (source: string, folder: typeof FOLDER, title: string) =>
      run(evidence.copyFile(source, folder, title)),
    selectFile: async (name: string) => Option.getOrNull(await run(evidence.selectFile(name))),
  };
}

function nameOf(uri: string) {
  return uri.slice(EVIDENCE_ROUTE.length);
}

describe('Evidence', () => {
  test('chat images stay at the top, attached evidence goes under its task and round', async () => {
    const dir = createTempDir();
    const store = openStore(dir);
    const image = await store.writeImage(Buffer.from('png').toString('base64'), 'image/png');
    const odd = await store.writeImage('', 'image/');
    const text = await store.writeText('all green', FOLDER, 'Unit tests: all pass!');
    const note = await store.writeText('| a | b |', FOLDER, 'Contrast', 'md');
    const source = join(createTempDir(), 'Screen Shot.PNG');
    writeFileSync(source, 'shot');
    const copied = await store.copyFile(source, { taskId: 'task-1', round: 3 }, '---');
    const bare = join(createTempDir(), 'LOG');
    writeFileSync(bare, 'log');
    expect(image).toMatch(/^\/api\/evidence\/\w+\.png$/);
    expect(odd.endsWith('.png')).toBe(true);
    expect(text).toMatch(/^\/api\/evidence\/task-1\/round-1\/unit-tests-all-pass-\w+\.txt$/);
    expect(note).toMatch(/^\/api\/evidence\/task-1\/round-1\/contrast-\w+\.md$/);
    expect(copied).toMatch(/^\/api\/evidence\/task-1\/round-3\/evidence-\w+\.png$/);
    expect((await store.copyFile(bare, FOLDER, 'Log')).endsWith('.bin')).toBe(true);
    expect(readFileSync(join(dir, nameOf(text)), 'utf8')).toBe('all green');
    expect(readFileSync(join(dir, nameOf(copied)), 'utf8')).toBe('shot');
    expect(await store.selectFile(nameOf(copied))).toBe(join(dir, nameOf(copied)));
  });

  test('copying something that is not a file, or too large, is refused', async () => {
    const store = openStore(createTempDir());
    const folder = createTempDir();
    await expect(store.copyFile(join(folder, 'missing.png'), FOLDER, 'x')).rejects.toThrow('No file at');
    await expect(store.copyFile(folder, FOLDER, 'x')).rejects.toThrow('No file at');
    const huge = join(folder, 'huge.webm');
    writeFileSync(huge, '');
    truncateSync(huge, EVIDENCE_COPY_LIMIT_BYTES + 1);
    await expect(store.copyFile(huge, FOLDER, 'x')).rejects.toThrow('is 201 MB; the limit is 200 MB.');
  });

  test('a task id that cannot name a folder is refused', () => {
    expect(Effect.runSync(resolveFolderPath({ taskId: 'abc', round: 2 }))).toBe('abc/round-2');
    expect(Effect.runSync(Effect.flip(resolveFolderPath({ taskId: '../x', round: 1 }))).message).toContain(
      'cannot name an evidence folder'
    );
  });

  test('only plain names, or a task, a round and a name, resolve inside the evidence directory', async () => {
    const dir = createTempDir();
    mkdirSync(join(dir, 'nested'));
    mkdirSync(join(dir, 'task-1', 'round-1', 'deep'), { recursive: true });
    writeFileSync(join(dir, 'seed-image-1.png'), 'x');
    writeFileSync(join(dir, 'nested', 'x'), 'x');
    writeFileSync(join(dir, 'task-1', 'round-1', 'shot.png'), 'x');
    const store = openStore(dir);
    expect(await store.selectFile('seed-image-1.png')).toBe(join(dir, 'seed-image-1.png'));
    expect(await store.selectFile('task-1/round-1/shot.png')).toBe(
      join(dir, 'task-1', 'round-1', 'shot.png')
    );
    expect(await store.selectFile('missing.png')).toBeNull();
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
      expect(await store.selectFile(name)).toBeNull();
    }
  });
});
