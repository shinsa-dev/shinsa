import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Context, Effect, Exit, Layer, Scope } from 'effect';
import { createServerInstance } from '../../../src/instance/index.ts';
import { LOCK_FILE, ServerRunning } from '../../../src/instance/lock/schema.ts';
import { ServeLock } from '../../../src/instance/lock/service.ts';
import { runTest } from '../../harness.ts';
import { createTempDir } from '../../helpers/index.ts';

const owner = { ...createServerInstance('e'.repeat(40), 9), port: 5180, url: 'http://127.0.0.1:5180' };

describe('ServeLock', () => {
  test('holds serve.lock while its scope is open and gives it back when the scope closes', async () => {
    const dataDir = createTempDir();
    const path = join(dataDir, LOCK_FILE);
    const held = await runTest(
      Effect.scoped(
        Effect.gen(function* () {
          const lock = yield* Layer.build(ServeLock.layer(dataDir, owner, { bootedAt: 5 })).pipe(
            Effect.map((context) => Context.get(context, ServeLock))
          );
          yield* lock.update({ port: 6000, url: 'http://127.0.0.1:6000' });
          return { exists: existsSync(path), holder: yield* lock.holder };
        })
      )
    );
    expect(held).toEqual({
      exists: true,
      holder: { ...owner, port: 6000, url: 'http://127.0.0.1:6000', bootedAt: 5 },
    });
    expect(existsSync(path)).toBe(false);
  });

  test('a second lock on the same folder fails with ServerRunning naming the holder', async () => {
    const dataDir = createTempDir();
    const scope = Scope.makeUnsafe();
    await runTest(Layer.buildWithScope(ServeLock.layer(dataDir, owner, { bootedAt: 5 }), scope));
    const error = await runTest(
      Effect.flip(Effect.scoped(Layer.build(ServeLock.layer(dataDir, owner, { bootedAt: 5 }))))
    );
    await runTest(Scope.close(scope, Exit.void));
    expect(error).toBeInstanceOf(ServerRunning);
    expect(error).toMatchObject({
      _tag: 'ServerRunning',
      dataDir,
      holder: { pid: process.pid, bootedAt: 5 },
    });
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(false);
  });
});
