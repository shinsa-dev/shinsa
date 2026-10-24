import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ChatNotice } from '@shinsa/core';
import type { EunoeStatus } from '../../src/agents/providers/claude/index.ts';
import { EunoeProxy, type EunoeProxyOptions, resolveEunoeCommand } from '../../src/eunoe/index.ts';
import { log } from '../../src/log/index.ts';
import { createTempDir, until } from '../helpers/index.ts';

const FAKE = resolve(import.meta.dirname, '../helpers/bin/eunoe');

const proxies: EunoeProxy[] = [];

const servers: ReturnType<typeof Bun.serve>[] = [];

afterEach(async () => {
  for (const proxy of proxies.splice(0)) await proxy.stop();
  for (const server of servers.splice(0)) server.stop(true);
});

function createProxy(overrides: Partial<EunoeProxyOptions> = {}) {
  const dir = join(createTempDir(), 'eunoe');
  const clock = { now: 1_000_000 };
  const proxy = new EunoeProxy({
    dir,
    command: [FAKE],
    startTimeoutMs: 5_000,
    pollMs: 5,
    now: () => clock.now,
    ...overrides,
  });
  proxies.push(proxy);
  return { proxy, dir, clock };
}

function readConfig(dir: string) {
  return JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as Record<string, unknown>;
}

function readPid(dir: string) {
  return Number(readFileSync(join(dir, 'serve.pid'), 'utf8'));
}

function expectUp(status: EunoeStatus) {
  if (!status.ok) throw new Error(`eunoe is down: ${status.reason}`);
  return status;
}

async function isAnswering(url: string) {
  try {
    return (await fetch(`${url}/_eunoe/health`)).ok;
  } catch {
    return false;
  }
}

async function untilSilent(url: string) {
  const deadline = Date.now() + 5_000;
  while (await isAnswering(url)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${url} to stop answering.`);
    await Bun.sleep(10);
  }
}

function serveForeignEunoe() {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => Response.json({ ok: true, version: 'theirs', mode: 'default', pid: 1 }),
  });
  servers.push(server);
  return server.port as number;
}

function behave(dir: string, behaviour: Record<string, unknown>) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'fake.json'), JSON.stringify(behaviour));
}

describe('running eunoe for Shinsa', () => {
  test('starts eunoe in Shinsa’s own folder on a free port, in the chosen mode, knowing every account folder', async () => {
    const { proxy, dir, clock } = createProxy();
    const first = expectUp(await proxy.ensure('compact', '/accounts/one'));
    expect(first.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(first.dir).toBe(dir);
    expect(await isAnswering(first.url)).toBe(true);
    expect(readConfig(dir)).toEqual({
      port: Number(first.url.split(':').at(-1)),
      mode: 'compact',
      upstream: 'https://api.anthropic.com',
      claudeConfigDirs: ['/accounts/one'],
    });
    const pid = readPid(dir);
    expect(await proxy.ensure('default', '/accounts/two')).toEqual(first);
    expect(readConfig(dir)).toMatchObject({
      mode: 'default',
      claudeConfigDirs: ['/accounts/one', '/accounts/two'],
    });
    clock.now += 60_000;
    expect(await proxy.ensure('default', null)).toEqual(first);
    expect(readPid(dir)).toBe(pid);
  });

  test('a proxy that died is started again for the next run', async () => {
    const { proxy, dir, clock } = createProxy();
    const first = expectUp(await proxy.ensure('compact', null));
    process.kill(readPid(dir), 'SIGKILL');
    await untilSilent(first.url);
    await until('Shinsa to notice', () => !existsSync(join(dir, 'serve.pid')));
    clock.now += 60_000;
    const again = expectUp(await proxy.ensure('compact', null));
    expect(again.url).toBe(first.url);
    expect(await isAnswering(again.url)).toBe(true);
  });

  test('a proxy that cannot start says what it printed, and is tried again only after a minute', async () => {
    const { proxy, dir, clock } = createProxy();
    behave(dir, { fail: 'error: Cannot find module "eunoe"' });
    const failed = await proxy.ensure('compact', null);
    expect(failed).toEqual({
      ok: false,
      reason: 'Eunoe stopped before it answered: error: Cannot find module "eunoe".',
    });
    rmSync(join(dir, 'fake.json'));
    clock.now += 30_000;
    expect(await proxy.ensure('compact', null)).toEqual(failed);
    clock.now += 31_000;
    expect((await proxy.ensure('compact', null)).ok).toBe(true);
  });

  test('a proxy that never answers is stopped when the start times out', async () => {
    const { proxy, dir } = createProxy({ startTimeoutMs: 500 });
    behave(dir, { hang: true });
    expect(await proxy.ensure('compact', null)).toEqual({
      ok: false,
      reason: 'Eunoe did not answer within 0.5 s.',
    });
  });

  test('eunoe that is missing, or cannot be run at all, is reported in a sentence', async () => {
    const missing = join(createTempDir(), 'missing-eunoe');
    expect(await createProxy({ command: [missing] }).proxy.ensure('compact', null)).toEqual({
      ok: false,
      reason: `Eunoe was not found at ${missing}.`,
    });
    const locked = join(createTempDir(), 'eunoe');
    writeFileSync(locked, '#!/bin/sh\n', { mode: 0o644 });
    const status = await createProxy({ command: [locked] }).proxy.ensure('compact', null);
    expect(status.ok ? '' : status.reason).toStartWith('Eunoe could not start: ');
    expect(status.ok ? '' : status.reason).toEndWith('.');
    expect(await createProxy({ command: null }).proxy.ensure('default', null)).toEqual({
      ok: false,
      reason: 'Eunoe is not installed with this Shinsa.',
    });
  });

  test('a port another program holds is never used: a chosen one fails clearly, a remembered one is replaced', async () => {
    const theirs = serveForeignEunoe();
    const pinned = createProxy({ port: theirs });
    expect(await pinned.proxy.ensure('compact', null)).toEqual({
      ok: false,
      reason: `Port ${theirs} is in use by another program.`,
    });
    const remembered = createProxy();
    mkdirSync(remembered.dir, { recursive: true });
    writeFileSync(join(remembered.dir, 'config.json'), JSON.stringify({ port: theirs }));
    const status = expectUp(await remembered.proxy.ensure('compact', null));
    expect(status.url).not.toBe(`http://127.0.0.1:${theirs}`);
    expect(await isAnswering(status.url)).toBe(true);
  });

  test('a proxy an earlier Shinsa left running is used again, and stopped with this one', async () => {
    const { proxy, dir } = createProxy();
    const first = expectUp(await proxy.ensure('compact', null));
    const pid = readPid(dir);
    const later = new EunoeProxy({ dir, command: [FAKE] });
    proxies.push(later);
    expect(await later.ensure('default', null)).toEqual(first);
    expect(readPid(dir)).toBe(pid);
    expect(readConfig(dir).mode).toBe('default');
    await later.stop();
    await untilSilent(first.url);
    expect(existsSync(join(dir, 'serve.pid'))).toBe(false);
  });

  test('stopping ends a start in flight and refuses every later run', async () => {
    const { proxy, dir } = createProxy({ startTimeoutMs: 60_000 });
    behave(dir, { hang: true });
    const starting = proxy.ensure('compact', null);
    await until('the proxy process', () => existsSync(join(dir, 'serve.pid')));
    await proxy.stop();
    expect(await starting).toEqual({ ok: false, reason: 'Shinsa is stopping.' });
    expect(await proxy.ensure('compact', null)).toEqual({ ok: false, reason: 'Shinsa is stopping.' });
  });

  test('a fold eunoe logs for a session reaches whoever watches that session', async () => {
    const { proxy } = createProxy();
    const status = expectUp(await proxy.ensure('default', null));
    const seen: ChatNotice[] = [];
    const stop = proxy.watch('sess-1', (notice) => seen.push(notice));
    const response = await fetch(`${status.url}/v1/messages`, {
      method: 'POST',
      headers: { 'x-claude-code-session-id': 'sess-1', authorization: 'Bearer account-one' },
      body: JSON.stringify({ fold: 'roll' }),
    });
    expect(await response.json()).toEqual({ mode: 'default', authorization: 'Bearer account-one' });
    await until('the fold', () => seen.length === 1);
    stop();
    expect(seen).toEqual([
      { kind: 'compaction', trigger: 'fold', preTokens: null, summary: null, by: 'eunoe' },
    ]);
  });
});

describe('resolveEunoeCommand', () => {
  test('runs the eunoe Shinsa ships with, or the one SHINSA_EUNOE names', () => {
    const [runtime, main] = resolveEunoeCommand(null) ?? [];
    expect(runtime).toBe(process.execPath);
    expect(main).toEndWith(join('@chroxify', 'eunoe', 'src', 'cli', 'main.ts'));
    expect(existsSync(main ?? '')).toBe(true);
    expect(resolveEunoeCommand('~/bin/eunoe')).toEqual([join(homedir(), 'bin/eunoe')]);
    expect(resolveEunoeCommand('/opt/eunoe')).toEqual(['/opt/eunoe']);
  });

  test('a Shinsa without the bundled eunoe still starts, and its runs go to Claude directly', () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const command = resolveEunoeCommand(null, () => {
      throw new Error('Cannot find package "@chroxify/eunoe"');
    });
    expect(command).toBeNull();
    expect(warn).toHaveBeenCalledWith('[Eunoe] The bundled eunoe could not be found', {
      error: 'Cannot find package "@chroxify/eunoe"',
    });
    warn.mockRestore();
  });
});
