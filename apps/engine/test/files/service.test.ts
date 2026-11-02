import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Option, Schema } from 'effect';
import { keepJsonFileAside, writeJsonFile } from '../../src/files/index.ts';
import { JsonFile } from '../../src/files/service.ts';
import { createTempDir } from '../helpers/index.ts';

const Counter = Schema.Struct({ count: Schema.Number });

function read(path: string) {
  return Effect.runPromise(
    JsonFile.use((file) => file.read(path, Counter)).pipe(
      Effect.provide(JsonFile.layer),
      Effect.flip,
      Effect.option
    )
  );
}

function readValue(path: string) {
  return Effect.runPromise(
    JsonFile.use((file) => file.read(path, Counter)).pipe(Effect.provide(JsonFile.layer))
  );
}

describe('JsonFile', () => {
  test('a missing file reads as nothing, and what it writes reads back through the schema', async () => {
    const path = join(createTempDir(), 'nested', 'counter.json');
    expect(await readValue(path)).toEqual(Option.none());
    writeJsonFile(path, { count: 2 });
    expect(await readValue(path)).toEqual(Option.some({ count: 2 }));
    expect(readFileSync(path, 'utf8')).toBe('{\n  "count": 2\n}\n');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(existsSync(`${path}.writing-${process.pid}`)).toBe(false);
  });

  test('text that is not JSON, or JSON that breaks the schema, is unreadable with its reason', async () => {
    const dir = createTempDir();
    writeFileSync(join(dir, 'broken.json'), '{"count": ');
    writeFileSync(join(dir, 'wrong.json'), '{"count": "two"}');
    const broken = await read(join(dir, 'broken.json'));
    expect(Option.getOrThrow(broken)).toMatchObject({
      _tag: 'JsonFileUnreadable',
      path: join(dir, 'broken.json'),
    });
    const wrong = await read(join(dir, 'wrong.json'));
    expect(Option.getOrThrow(wrong).reason).toContain('Expected number');
    mkdirSync(join(dir, 'folder.json'));
    expect(Option.getOrThrow(await read(join(dir, 'folder.json'))).reason).toContain('EISDIR');
  });

  test('keeps a copy of a broken file aside, and a write it cannot make fails with the path', async () => {
    const dir = createTempDir();
    const path = join(dir, 'broken.json');
    writeFileSync(path, '{"count": ');
    const copy = keepJsonFileAside(path);
    expect(copy).toStartWith(`${path}.unreadable-`);
    expect(readFileSync(copy, 'utf8')).toBe('{"count": ');
    expect(() => keepJsonFileAside(join(dir, 'gone.json'))).toThrow('ENOENT');
    writeFileSync(join(dir, 'file'), '');
    expect(() => writeJsonFile(join(dir, 'file', 'inside.json'), {})).toThrow();
    expect(readdirSync(dir).sort()).toEqual(['broken.json', copy.slice(dir.length + 1), 'file'].sort());
  });
});
