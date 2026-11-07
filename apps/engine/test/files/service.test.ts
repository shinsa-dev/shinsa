import { describe, expect, test } from 'bun:test';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Option, Schema } from 'effect';
import { JsonFile } from '../../src/files/service.ts';
import { JsonFileLayer } from '../helpers/files.ts';
import { createTempDir } from '../helpers/index.ts';

const writeJsonFile = (path: string, value: unknown) =>
  Effect.runPromise(JsonFile.use((file) => file.write(path, value)).pipe(Effect.provide(JsonFileLayer)));

const keepJsonFileAside = (path: string) =>
  Effect.runPromise(JsonFile.use((file) => file.keepAside(path)).pipe(Effect.provide(JsonFileLayer)));

const Counter = Schema.Struct({ count: Schema.Number });

function read(path: string) {
  return Effect.runPromise(
    JsonFile.use((file) => file.read(path, Counter)).pipe(
      Effect.provide(JsonFileLayer),
      Effect.flip,
      Effect.option
    )
  );
}

function readValue(path: string) {
  return Effect.runPromise(
    JsonFile.use((file) => file.read(path, Counter)).pipe(Effect.provide(JsonFileLayer))
  );
}

describe('JsonFile', () => {
  test('a missing file reads as nothing, and what it writes reads back through the schema', async () => {
    const path = join(createTempDir(), 'nested', 'counter.json');
    expect(await readValue(path)).toEqual(Option.none());
    await writeJsonFile(path, { count: 2 });
    expect(await readValue(path)).toEqual(Option.some({ count: 2 }));
    expect(readFileSync(path, 'utf8')).toBe('{\n  "count": 2\n}\n');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(path, '..'))).toEqual(['counter.json']);
  });

  test('two writers of one file at once each finish, and leave no staging file behind', async () => {
    const dir = createTempDir();
    const path = join(dir, 'counter.json');
    await Promise.all(Array.from({ length: 8 }, (_, count) => writeJsonFile(path, { count })));
    expect(readdirSync(dir)).toEqual(['counter.json']);
    expect(Option.isSome(await readValue(path))).toBe(true);
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
    const copy = await keepJsonFileAside(path);
    expect(copy).toStartWith(`${path}.unreadable-`);
    expect(readFileSync(copy, 'utf8')).toBe('{"count": ');
    await expect(keepJsonFileAside(join(dir, 'gone.json'))).rejects.toThrow('ENOENT');
    writeFileSync(join(dir, 'file'), '');
    await expect(writeJsonFile(join(dir, 'file', 'inside.json'), {})).rejects.toThrow();
    expect(readdirSync(dir).sort()).toEqual(['broken.json', copy.slice(dir.length + 1), 'file'].sort());
  });

  test('writes to one file one at a time, in the order they were asked for', async () => {
    const path = join(createTempDir(), 'counter.json');
    await Effect.runPromise(
      JsonFile.use((file) =>
        Effect.all(
          [1, 2, 3, 4].map((count) => file.write(path, { count })),
          { concurrency: 'unbounded' }
        )
      ).pipe(Effect.provide(JsonFileLayer))
    );
    expect(await readValue(path)).toEqual(Option.some({ count: 4 }));
  });
});
