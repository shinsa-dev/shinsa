import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BunServices } from '@effect/platform-bun';
import { Effect, Layer, Option } from 'effect';
import { Files } from '../../src/files/service.ts';
import { FilesLive } from '../../src/main/files.ts';

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function createFolder() {
  const folder = mkdtempSync(join(tmpdir(), 'desktop-files-'));
  folders.push(folder);
  return folder;
}

function run<A, E>(effect: Effect.Effect<A, E, Files>) {
  return Effect.runPromise(effect.pipe(Effect.provide(FilesLive.pipe(Layer.provide(BunServices.layer)))));
}

describe('FilesLive', () => {
  it('writes, appends, reads and sizes a file, making its folder first', async () => {
    const path = join(createFolder(), 'logs', 'app.log');
    const read = await run(
      Effect.gen(function* () {
        const files = yield* Files;
        yield* files.writeText(path, 'one\n');
        yield* files.appendText(path, 'two\n');
        return {
          text: yield* files.readText(path),
          size: yield* files.readSize(path),
          exists: yield* files.exists(path),
          entry: yield* files.readEntry(path),
        };
      })
    );
    expect(read).toEqual({
      text: Option.some('one\ntwo\n'),
      size: Option.some(8),
      exists: true,
      entry: { kind: 'file' },
    });
  });

  it('links, renames and removes, and a missing path reads as missing', async () => {
    const folder = createFolder();
    const link = join(folder, 'bin', 'shinsa');
    const read = await run(
      Effect.gen(function* () {
        const files = yield* Files;
        yield* files.link('/Applications/Shinsa.app', link);
        const linked = yield* files.readEntry(link);
        yield* files.writeText(join(folder, 'a'), 'x');
        yield* files.rename(join(folder, 'a'), join(folder, 'b'));
        const renamed = yield* files.readText(join(folder, 'b'));
        yield* files.remove(join(folder, 'bin'));
        return {
          linked,
          renamed,
          removed: yield* files.readEntry(link),
          missing: yield* files.readText(join(folder, 'nothing')),
          missingSize: yield* files.readSize(join(folder, 'nothing')),
        };
      })
    );
    expect(read).toEqual({
      linked: { kind: 'link', target: '/Applications/Shinsa.app' },
      renamed: Option.some('x'),
      removed: { kind: 'missing' },
      missing: Option.none(),
      missingSize: Option.none(),
    });
  });

  it('a write it cannot make fails with the path', async () => {
    const blocked = join(createFolder(), 'file');
    const error = await run(
      Effect.gen(function* () {
        const files = yield* Files;
        yield* files.writeText(blocked, 'x');
        return yield* Effect.flip(files.writeText(join(blocked, 'inside'), 'y'));
      })
    );
    expect(error._tag).toBe('FileWriteFailed');
    expect(error.path).toBe(join(blocked, 'inside'));
    const rename = await run(
      Effect.flip(Effect.flatMap(Files, (files) => files.rename(join(blocked, 'x'), blocked)))
    );
    expect(rename.path).toBe(join(blocked, 'x'));
  });
});
