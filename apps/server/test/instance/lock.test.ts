import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  acquireDataDirLock,
  createServerInstance,
  type DataDirLock,
  isProcessAlive,
  LOCK_FILE,
  type LockHolder,
  resolveBootedAt,
  selectLockHolder,
} from '../../src/instance/index.ts';
import { log } from '../../src/log/index.ts';
import { createTempDir } from '../helpers/index.ts';

const BOOTED_AT = 1_000_000;

const held: DataDirLock[] = [];

afterEach(() => {
  for (const lock of held.splice(0)) lock.release();
});

function createOwner(port = 5180) {
  return { ...createServerInstance('c'.repeat(40), 42), port, url: `http://127.0.0.1:${port}` };
}

function acquire(dataDir: string, options: Parameters<typeof acquireDataDirLock>[2] = {}) {
  const lock = acquireDataDirLock(dataDir, createOwner(), { bootedAt: BOOTED_AT, ...options });
  held.push(lock);
  return lock;
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

function quietly<T>(work: () => T) {
  const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
  try {
    return { result: work(), warnings: warn.mock.calls.map((call) => call[0]) };
  } finally {
    warn.mockRestore();
  }
}

describe('the data directory lock', () => {
  test('records who holds it, and a second server on the same folder is refused with the first one’s address', () => {
    const dataDir = createTempDir();
    const lock = acquire(dataDir);
    expect(selectLockHolder(dataDir)).toEqual({ ...createOwner(), bootedAt: BOOTED_AT });
    lock.update({ port: 6123, url: 'http://127.0.0.1:6123' });
    expect(lock.holder()).toMatchObject({ port: 6123, url: 'http://127.0.0.1:6123' });
    expect(selectLockHolder(dataDir)).toMatchObject({ port: 6123, pid: process.pid });
    expect(() => acquire(dataDir)).toThrow(
      `Shinsa is already running on ${dataDir}: http://127.0.0.1:6123 (pid ${process.pid}, version 0.0.0 (ccccccc)). Stop it first, or set SHINSA_HOME to another folder.`
    );
    expect(readdirSync(dataDir)).toEqual([LOCK_FILE]);
  });

  test('a live process in another program holds it too', () => {
    const dataDir = createTempDir();
    writeHolder(dataDir, { commit: null });
    expect(() => acquire(dataDir, { isAlive: (pid) => pid === 999_999 })).toThrow(
      'http://127.0.0.1:5190 (pid 999999, version 0.0.1)'
    );
  });

  test('releasing removes it, so the next server starts; releasing twice or after another took it changes nothing', () => {
    const dataDir = createTempDir();
    const first = acquire(dataDir);
    first.release();
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(false);
    first.release();
    const second = acquire(dataDir);
    writeHolder(dataDir, { pid: process.pid, startedAt: 1 });
    second.release();
    expect(selectLockHolder(dataDir)?.startedAt).toBe(1);
  });

  test('a lock a stopped server left behind is taken over: a dead pid, another boot, this pid from before, or garbage', () => {
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
      const { result, warnings } = quietly(() => acquire(dir, { isAlive: (pid) => pid !== 999_999 }));
      expect({ name, pid: result.holder().pid }).toEqual({ name, pid: process.pid });
      expect(warnings).toEqual(['[Serve] Took over the lock a stopped Shinsa left behind']);
      expect(selectLockHolder(dir)?.pid).toBe(process.pid);
    }
  });

  test('gives up when another server keeps replacing the lock while this one starts', () => {
    const dataDir = createTempDir();
    writeHolder(dataDir);
    let replaced = 0;
    const isAlive = () => {
      replaced += 1;
      writeHolder(dataDir, { startedAt: replaced });
      return false;
    };
    expect(() => acquire(dataDir, { isAlive })).toThrow(
      `Another Shinsa kept taking the lock on ${dataDir} while this one started. Try again.`
    );
    expect(replaced).toBe(3);
  });

  test('a lock it cannot read stops the start instead of being taken over', () => {
    const dataDir = createTempDir();
    writeHolder(dataDir);
    chmodSync(join(dataDir, LOCK_FILE), 0o000);
    try {
      expect(() => acquire(dataDir)).toThrow('EACCES');
      expect(() => selectLockHolder(dataDir)).toThrow('EACCES');
    } finally {
      chmodSync(join(dataDir, LOCK_FILE), 0o600);
    }
    expect(JSON.parse(readFileSync(join(dataDir, LOCK_FILE), 'utf8')).pid).toBe(999_999);
  });

  test('without a lock there is no holder', () => {
    expect(selectLockHolder(createTempDir())).toBeNull();
  });

  test('a missing folder is an error, not a lock', () => {
    expect(() => acquire(join(createTempDir(), 'missing'))).toThrow('ENOENT');
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
