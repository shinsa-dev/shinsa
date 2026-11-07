import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BunServices } from '@effect/platform-bun';
import { Effect, type FileSystem } from 'effect';
import { CHAT_PROTOCOL_VERSION } from '../../packages/core/src/index.ts';
import {
  readSeedText,
  removeSeedPath,
  writeSeedFile,
  writeSeedFiles,
  writeSeedTranscripts,
} from './files.ts';

let root = '';

afterEach(() => rmSync(root, { recursive: true, force: true }));

function runWithFiles<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) {
  return Effect.runPromise(effect.pipe(Effect.provide(BunServices.layer)));
}

describe('the seed’s files', () => {
  test('writes text and bytes into folders it makes, reads text back and removes a folder', async () => {
    root = mkdtempSync(join(tmpdir(), 'seed-files-'));
    const bytes = new Uint8Array([0, 255, 7]);
    const read = await runWithFiles(
      Effect.gen(function* () {
        yield* writeSeedFiles(root, { 'a/b/one.txt': 'one', 'two.txt': 'two' });
        yield* writeSeedFile(join(root, 'bin/blob'), bytes);
        const one = yield* readSeedText(join(root, 'a/b/one.txt'));
        yield* removeSeedPath(join(root, 'a'));
        yield* removeSeedPath(join(root, 'gone'));
        return one;
      })
    );
    expect(read).toBe('one');
    expect(readFileSync(join(root, 'two.txt'), 'utf8')).toBe('two');
    expect([...readFileSync(join(root, 'bin/blob'))]).toEqual([0, 255, 7]);
    expect(() => readFileSync(join(root, 'a/b/one.txt'))).toThrow();
  });

  test('writes each transcript as one line per entry, numbered from its run', async () => {
    root = mkdtempSync(join(tmpdir(), 'seed-files-'));
    await runWithFiles(
      writeSeedTranscripts(root, [
        {
          runId: 'run-1',
          timed: [
            { at: 10, event: { type: 'status', status: 'started', outcome: null } },
            { at: 20, event: { type: 'status', status: 'ended', outcome: 'completed' } },
          ],
        },
      ])
    );
    const lines = readFileSync(join(root, 'run-1.jsonl'), 'utf8').trimEnd().split('\n');
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { type: 'status', status: 'started', outcome: null, v: CHAT_PROTOCOL_VERSION, id: 'run-1-0', at: 10 },
      {
        type: 'status',
        status: 'ended',
        outcome: 'completed',
        v: CHAT_PROTOCOL_VERSION,
        id: 'run-1-1',
        at: 20,
      },
    ]);
  });
});
