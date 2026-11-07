import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Layer } from 'effect';
import { JsonLogger } from '../../src/log/service.ts';
import { TERMINALS_DIR } from '../../src/terminals/schema.ts';
import { TerminalFiles } from '../../src/terminals/store/service.ts';
import { JsonFileLayer } from '../helpers/files.ts';
import { captureLogs } from '../helpers/logs.ts';
import { createTempDir } from '../helpers/temp.ts';

function runFiles<A, E>(effect: Effect.Effect<A, E, TerminalFiles>) {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(Layer.merge(TerminalFiles.layer.pipe(Layer.provide(JsonFileLayer)), JsonLogger))
    )
  );
}

const files = {
  read: (dataDir: string, id: string) =>
    runFiles(TerminalFiles.use((store) => store.readScreen(dataDir, id))),
  write: (dataDir: string, id: string, screen: string) =>
    runFiles(TerminalFiles.use((store) => store.writeScreen(dataDir, id, screen))),
  remove: (dataDir: string, id: string) =>
    runFiles(TerminalFiles.use((store) => store.removeScreen(dataDir, id))),
};

describe('a terminal’s saved screen', () => {
  test('is written, read back and removed, and a missing one reads as nothing', async () => {
    const dataDir = createTempDir();
    expect(await files.read(dataDir, 'term-1')).toBeNull();
    await files.write(dataDir, 'term-1', 'hello');
    expect(await files.read(dataDir, 'term-1')).toBe('hello');
    await files.remove(dataDir, 'term-1');
    await files.remove(dataDir, 'term-1');
    expect(await files.read(dataDir, 'term-1')).toBeNull();
  });

  test('a screen it cannot save or remove is logged, not thrown', async () => {
    const dataDir = createTempDir();
    writeFileSync(join(dataDir, TERMINALS_DIR), '');
    const blocked = createTempDir();
    mkdirSync(join(blocked, TERMINALS_DIR, 'term-2.screen'), { recursive: true });
    writeFileSync(join(blocked, TERMINALS_DIR, 'term-2.screen', 'inside'), '');
    const logs = captureLogs();
    await files.write(dataDir, 'term-1', 'hello');
    await files.remove(blocked, 'term-2');
    logs.restore();
    expect(logs.fieldsOf('[Terminals] Could not save a terminal’s screen')).toEqual([
      expect.objectContaining({ terminalId: 'term-1' }),
    ]);
    expect(logs.fieldsOf('[Terminals] Could not remove a terminal’s saved screen')).toEqual([
      expect.objectContaining({ terminalId: 'term-2' }),
    ]);
  });
});
