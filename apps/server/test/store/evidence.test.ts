import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVIDENCE_ROUTE, EvidenceStore } from '../../src/store/index.ts';
import { createTempDir } from '../helpers/index.ts';

function nameOf(uri: string) {
  return uri.slice(EVIDENCE_ROUTE.length);
}

describe('EvidenceStore', () => {
  test('images, text and copied files get fresh names under the evidence route', () => {
    const dir = createTempDir();
    const store = new EvidenceStore(dir);
    const image = store.writeImage(Buffer.from('png').toString('base64'), 'image/png');
    const odd = store.writeImage('', 'image/');
    const text = store.writeText('all green');
    const source = join(createTempDir(), 'Screen Shot.PNG');
    writeFileSync(source, 'shot');
    const copied = store.copyFile(source);
    const bare = join(createTempDir(), 'LOG');
    writeFileSync(bare, 'log');
    expect(image).toMatch(/^\/api\/evidence\/[\w-]+\.png$/);
    expect(odd.endsWith('.png')).toBe(true);
    expect(copied.endsWith('.png')).toBe(true);
    expect(store.copyFile(bare).endsWith('.bin')).toBe(true);
    expect(readFileSync(join(dir, nameOf(text)), 'utf8')).toBe('all green');
    expect(readFileSync(join(dir, nameOf(copied)), 'utf8')).toBe('shot');
  });

  test('copying something that is not a file is refused', () => {
    const store = new EvidenceStore(createTempDir());
    const folder = createTempDir();
    expect(() => store.copyFile(join(folder, 'missing.png'))).toThrow('No file at');
    expect(() => store.copyFile(folder)).toThrow('No file at');
  });

  test('only plain names inside the evidence directory resolve', () => {
    const dir = createTempDir();
    mkdirSync(join(dir, 'nested'));
    writeFileSync(join(dir, 'seed-image-1.png'), 'x');
    const store = new EvidenceStore(dir);
    expect(store.selectFile('seed-image-1.png')).toBe(join(dir, 'seed-image-1.png'));
    expect(store.selectFile('missing.png')).toBeNull();
    for (const name of ['..', '.hidden', '..shinsa.sqlite', 'a..b', 'nested/x', '']) {
      expect(store.selectFile(name)).toBeNull();
    }
  });
});
