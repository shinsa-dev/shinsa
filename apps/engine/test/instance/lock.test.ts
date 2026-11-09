import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Exit, Scope } from 'effect';
import {
  createServerInstance,
  isProcessAlive,
  LOCK_FILE,
  type LockHolder,
  resolveBootedAt,
} from '../../src/instance/index.ts';
import { resolveLockError } from '../../src/instance/lock/index.ts';
import type { LockOptions } from '../../src/instance/lock/schema.ts';
import { ServeLock } from '../../src/instance/lock/service.ts';
import { runTest } from '../harness.ts';
import { captureLogs, createTempDir } from '../helpers/index.ts';
import { selectLockHolder } from '../helpers/lock.ts';

const BOOTED_AT = 1_000_000;

const held: Scope.Closeable[] = [];

afterEach(async () => {
  for (const scope of held.splice(0)) await Effect.runPromise(Scope.close(scope, Exit.void));
});

function createOwner(port = 5180) {
  return { ...createServerInstance('c'.repeat(40), 42), port, url: `http://127.0.0.1:${port}` };
}

function acquireIn(scope: Scope.Closeable, dataDir: string, options: LockOptions = {}) {
  return runTest(
    ServeLock.acquire(dataDir, createOwner(), { bootedAt: BOOTED_AT, ...options }).pipe(
      Effect.mapError(resolveLockError),
      Scope.provide(scope)
    )
  );
}

function acquire(dataDir: string, options: LockOptions = {}) {
  const scope = Scope.makeUnsafe();
  held.push(scope);
  return acquireIn(scope, dataDir, options);
}

function release(scope: Scope.Closeable) {
  return Effect.runPromise(Scope.close(scope, Exit.void));
}

function writeHolder(dataDir: string, overrides: Partial<LockHolder> = {}) {
  const holder: LockHolder = {
    ...createServerInstance('d'.repeat(40), 7),
    pid: 999_999,
    port: 5190,
    url: 'http://127.0.0.1:5190',
    version: '0.0.1',
    bootedAt: BOOTED_AT,
    ...overrides,
  };
  writeFileSync(join(dataDir, LOCK_FILE), JSON.stringify(holder));
  return holder;
}

async function quietly<T>(work: () => Promise<T>) {
  const logs = captureLogs();
  try {
    return { result: await work(), warnings: logs.entries.map((entry) => entry.message) };
  } finally {
    logs.restore();
  }
}

describe('the data directory lock', () => {
  test('records who holds it, and a second server on the same folder is refused with the first one’s address', async () => {
    const dataDir = createTempDir();
    const lock = await acquire(dataDir);
    expect(await selectLockHolder(dataDir)).toEqual({ ...createOwner(), bootedAt: BOOTED_AT });
    await runTest(lock.update({ port: 6123, url: 'http://127.0.0.1:6123' }));
    expect(await runTest(lock.holder)).toMatchObject({ port: 6123, url: 'http://127.0.0.1:6123' });
    expect(await selectLockHolder(dataDir)).toMatchObject({ port: 6123, pid: process.pid });
    await expect(acquire(dataDir)).rejects.toThrow(
      `Shinsa is already running on ${dataDir}: http://127.0.0.1:6123 (pid ${process.pid}, version 0.0.0 (ccccccc)). Stop it first, or set SHINSA_HOME to another folder.`
    );
    expect(readdirSync(dataDir)).toEqual([LOCK_FILE]);
  });

  test('a live process in another program holds it too, and the refusal names it', async () => {
    const dataDir = createTempDir();
    writeHolder(dataDir, { commit: null });
    const scope = Scope.makeUnsafe();
    const refused = await runTest(
      Effect.flip(
        ServeLock.acquire(dataDir, createOwner(), {
          bootedAt: BOOTED_AT,
          isAlive: (pid) => pid === 999_999,
        }).pipe(Effect.mapError(resolveLockError), Scope.provide(scope))
      )
    );
    expect(refused).toMatchObject({
      _tag: 'ServerRunningError',
      dataDir,
      holder: { pid: 999_999 },
    });
    expect(refused.message).toContain('http://127.0.0.1:5190 (pid 999999, version 0.0.1)');
  });

  test('releasing removes it, so the next server starts; releasing twice or after another took it changes nothing', async () => {
    const dataDir = createTempDir();
    const first = Scope.makeUnsafe();
    await acquireIn(first, dataDir);
    await release(first);
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(false);
    await release(first);
    const second = Scope.makeUnsafe();
    await acquireIn(second, dataDir);
    writeHolder(dataDir, { pid: process.pid, startedAt: 1 });
    await release(second);
    expect((await selectLockHolder(dataDir))?.startedAt).toBe(1);
  });

  test('a lock a stopped server left behind is taken over: a dead pid, another boot, this pid from before, or garbage', async () => {
    const cases: [string, () => void][] = [
      ['a dead pid', () => writeHolder(dir)],
      ['another boot', () => writeHolder(dir, { bootedAt: BOOTED_AT - 3_600_000 })],
      ['this pid, left by a process before this one', () => writeHolder(dir, { pid: process.pid })],
      ['garbage', () => writeFileSync(join(dir, LOCK_FILE), '{"pid":')],
      ['the wrong shape', () => writeFileSync(join(dir, LOCK_FILE), '[1]')],
    ];
    let dir = '';
    for (const [name, leave] of cases) {
      dir = createTempDir();
      leave();
      const { result, warnings } = await quietly(() => acquire(dir, { isAlive: (pid) => pid !== 999_999 }));
      expect({ name, pid: (await runTest(result.holder)).pid }).toEqual({ name, pid: process.pid });
      expect(warnings).toEqual(['[Serve] Took over the lock a stopped Shinsa left behind']);
      expect((await selectLockHolder(dir))?.pid).toBe(process.pid);
    }
  });

  test('gives up when another server keeps replacing the lock while this one starts', async () => {
    const dataDir = createTempDir();
    writeHolder(dataDir);
    let replaced = 0;
    const isAlive = () => {
      replaced += 1;
      writeHolder(dataDir, { startedAt: replaced });
      return false;
    };
    await expect(acquire(dataDir, { isAlive })).rejects.toThrow(
      `Another Shinsa kept taking the lock on ${dataDir} while this one started. Try again.`
    );
    expect(replaced).toBe(3);
  });

  test('a lock it cannot read stops the start instead of being taken over', async () => {
    const dataDir = createTempDir();
    writeHolder(dataDir);
    chmodSync(join(dataDir, LOCK_FILE), 0o000);
    try {
      await expect(acquire(dataDir)).rejects.toThrow('EACCES');
      await expect(selectLockHolder(dataDir)).rejects.toThrow('EACCES');
    } finally {
      chmodSync(join(dataDir, LOCK_FILE), 0o600);
    }
    expect(JSON.parse(readFileSync(join(dataDir, LOCK_FILE), 'utf8')).pid).toBe(999_999);
  });

  test('without a lock there is no holder', async () => {
    expect(await selectLockHolder(createTempDir())).toBeNull();
  });

  test('a missing folder is an error, not a lock', async () => {
    await expect(acquire(join(createTempDir(), 'missing'))).rejects.toThrow('ENOENT');
  });
});

describe('telling a live process from a dead one', () => {
  test('this process is alive, a finished one is not, and one of another user counts as alive', async () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    const child = Bun.spawn(['true']);
    await child.exited;
    expect(isProcessAlive(child.pid)).toBe(false);
    expect(isProcessAlive(1)).toBe(true);
  });

  test('the boot time stays put while the machine runs', () => {
    expect(Math.abs(resolveBootedAt() - resolveBootedAt())).toBeLessThan(2_000);
    expect(resolveBootedAt()).toBeLessThan(Date.now());
  });
});
