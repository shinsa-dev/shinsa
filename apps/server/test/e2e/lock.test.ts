import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LOCK_FILE, type ServerHealth, selectLockHolder } from '../../src/instance/index.ts';
import { createTempDir, until } from '../helpers/index.ts';

setDefaultTimeout(30_000);

const MAIN = join(import.meta.dirname, '../../src/main.ts');

const children: Bun.Subprocess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill('SIGKILL');
    await child.exited;
  }
});

function serve(home: string) {
  const child = Bun.spawn(['bun', MAIN, 'serve'], {
    env: { ...process.env, SHINSA_HOME: home, SHINSA_PORT: '0', SHINSA_INSPECT: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  children.push(child);
  return child;
}

describe('shinsa serve on a data directory another one holds', () => {
  test('refuses with the running one’s address, and starts once that one stopped', async () => {
    const home = createTempDir();
    const dataDir = join(home, 'data');
    const first = serve(home);
    await until('the first server to listen', () => (selectLockHolder(dataDir)?.port ?? 0) > 0, 20_000);
    const holder = selectLockHolder(dataDir);
    expect(holder?.pid).toBe(first.pid);
    const health = (await (await fetch(`${holder?.url}/api/health`)).json()) as ServerHealth;
    expect(health.pid).toBe(first.pid);

    const second = serve(home);
    expect(await second.exited).toBe(1);
    expect(await new Response(second.stderr).text()).toContain(
      `shinsa serve: Shinsa is already running on ${dataDir}: ${holder?.url} (pid ${first.pid}, version 0.0.0`
    );

    first.kill('SIGTERM');
    expect(await first.exited).toBe(0);
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(false);

    const third = serve(home);
    await until('the third server to listen', () => selectLockHolder(dataDir)?.pid === third.pid, 20_000);
  });

  test('takes over the lock a killed server left behind', async () => {
    const home = createTempDir();
    const dataDir = join(home, 'data');
    const killed = serve(home);
    await until('the server to listen', () => (selectLockHolder(dataDir)?.port ?? 0) > 0, 20_000);
    killed.kill('SIGKILL');
    await killed.exited;
    expect(selectLockHolder(dataDir)?.pid).toBe(killed.pid);
    const next = serve(home);
    await until(
      'the next server to take the lock',
      () => selectLockHolder(dataDir)?.pid === next.pid,
      20_000
    );
  });
});
