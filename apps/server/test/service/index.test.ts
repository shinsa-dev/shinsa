import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServerInstance, INSTALL_PATH, LOCK_FILE, SERVER_ENTRY } from '../../src/instance/index.ts';
import { createServiceControl, SERVICE_LABEL } from '../../src/service/index.ts';
import type { CommandResult } from '../../src/shell/index.ts';
import { createTempDir } from '../helpers/index.ts';

const TARGET = `gui/501/${SERVICE_LABEL}`;

interface FakeLaunchd {
  calls: string[][];
  loaded: boolean;
  pid: number | null;
  lastExitCode: number | null;
  unloads: boolean;
  fails: Set<string>;
}

function result(ok: boolean, stdout = '', stderr = ''): CommandResult {
  return { ok, code: ok ? 0 : 113, stdout, stderr, timedOut: false };
}

function createLaunchd(overrides: Partial<FakeLaunchd> = {}) {
  const launchd: FakeLaunchd = {
    calls: [],
    loaded: false,
    pid: null,
    lastExitCode: null,
    unloads: true,
    fails: new Set(),
    ...overrides,
  };
  const launchctl = (args: string[]) => {
    launchd.calls.push(args);
    const [verb = ''] = args;
    if (launchd.fails.has(verb))
      return Promise.resolve(result(false, '', `${verb} failed: 5: Input/output error`));
    if (verb === 'print') {
      if (!launchd.loaded) return Promise.resolve(result(false, '', 'Could not find service'));
      const lines = [
        `${TARGET} = {`,
        `\tstate = ${launchd.pid === null ? 'not running' : 'running'}`,
        ...(launchd.pid === null ? [] : [`\tpid = ${launchd.pid}`]),
        `\tlast exit code = ${launchd.lastExitCode ?? '(never exited)'}`,
        '}',
      ];
      return Promise.resolve(result(true, lines.join('\n')));
    }
    if (verb === 'bootout' && launchd.unloads) launchd.loaded = false;
    if (verb === 'bootstrap') launchd.loaded = true;
    return Promise.resolve(result(true));
  };
  return { launchd, launchctl };
}

function createControl(options: { platform?: string; launchd?: Partial<FakeLaunchd>; env?: object } = {}) {
  const home = createTempDir();
  const { launchd, launchctl } = createLaunchd(options.launchd);
  const service = createServiceControl({
    env: { HOME: home, SHINSA_PORT: '5190', SHINSA_EMPTY: '', OTHER: 'left out', ...options.env },
    launchctl,
    platform: options.platform ?? 'darwin',
    uid: 501,
    bun: '/Users/me/.bun/bin/bun',
    unloadTimeoutMs: 0,
  });
  const plist = join(home, 'Library/LaunchAgents', `${SERVICE_LABEL}.plist`);
  const dataDir = join(home, '.config/shinsa/data');
  return { service, launchd, home, plist, dataDir, log: join(dataDir, 'serve.log') };
}

function writeHolder(dataDir: string, pid: number) {
  mkdirSync(dataDir, { recursive: true });
  const holder = {
    ...createServerInstance('e'.repeat(40), 1),
    pid,
    port: 5190,
    url: 'http://127.0.0.1:5190',
    bootedAt: 1,
  };
  writeFileSync(join(dataDir, LOCK_FILE), JSON.stringify(holder));
}

describe('installing the background service', () => {
  test('writes the plist for this checkout’s bun and server and hands it to launchd', async () => {
    const { service, launchd, plist, log } = createControl();
    const installed = await service.install();
    expect(installed).toEqual({
      label: SERVICE_LABEL,
      plist,
      log,
      program: ['/Users/me/.bun/bin/bun', SERVER_ENTRY, 'serve'],
      replaced: false,
      running: null,
    });
    const written = readFileSync(plist, 'utf8');
    expect(written).toContain(`<string>${SERVER_ENTRY}</string>`);
    expect(written).toContain(`<key>WorkingDirectory</key>\n  <string>${INSTALL_PATH}</string>`);
    expect(written).toContain('<key>SHINSA_PORT</key>\n    <string>5190</string>');
    expect(written).not.toContain('SHINSA_EMPTY');
    expect(written).not.toContain('OTHER');
    expect(written).toContain(`<string>${log}</string>`);
    expect(launchd.calls).toEqual([
      ['print', TARGET],
      ['bootstrap', 'gui/501', plist],
    ]);
  });

  test('replaces a loaded service, and names a server already running on the data folder', async () => {
    const reinstall = createControl({ launchd: { loaded: true, pid: 77 } });
    expect(await reinstall.service.install()).toMatchObject({ replaced: true, running: null });
    expect(reinstall.launchd.calls.map((call) => call[0])).toEqual([
      'print',
      'bootout',
      'print',
      'bootstrap',
    ]);
    const busy = createControl();
    writeHolder(busy.dataDir, process.pid);
    expect((await busy.service.install()).running).toMatchObject({
      pid: process.pid,
      url: 'http://127.0.0.1:5190',
    });
  });

  test('a refused bootstrap is an error with launchd’s reason', async () => {
    const { service } = createControl({ launchd: { fails: new Set(['bootstrap']) } });
    await expect(service.install()).rejects.toThrow(
      'launchctl bootstrap gui/501 failed: bootstrap failed: 5'
    );
  });

  test('uses the bun on PATH by default and refuses anywhere but macOS', async () => {
    const { launchctl } = createLaunchd();
    const home = createTempDir();
    const installed = await createServiceControl({
      env: { HOME: home },
      launchctl,
      platform: 'darwin',
    }).install();
    expect(installed.program[0]).toBe(Bun.which('bun') ?? process.execPath);
    const linux = createControl({ platform: 'linux' });
    for (const action of [
      () => linux.service.install(),
      () => linux.service.uninstall(),
      () => linux.service.status(),
      () => linux.service.restart(),
    ]) {
      await expect(action()).rejects.toThrow('The background service runs on macOS only (launchd).');
    }
    expect(linux.launchd.calls).toEqual([]);
  });

  test('talks to launchctl itself by default (the fake one on PATH in tests)', async () => {
    const service = createServiceControl({ env: { HOME: createTempDir() }, platform: 'darwin' });
    expect(await service.status()).toMatchObject({ loaded: false, pid: null });
    await expect(service.install()).rejects.toThrow('The fake launchctl refuses bootstrap');
  });

  test('waits for launchd to let go of the old job, and gives up waiting after the timeout', async () => {
    const calls: string[] = [];
    let printsAfterBootout = -1;
    const slow = createServiceControl({
      env: { HOME: createTempDir() },
      launchctl: (args) => {
        calls.push(args[0] ?? '');
        if (args[0] === 'bootout') printsAfterBootout = 0;
        if (args[0] !== 'print') return Promise.resolve(result(true));
        if (printsAfterBootout < 0) return Promise.resolve(result(true));
        printsAfterBootout += 1;
        return Promise.resolve(result(printsAfterBootout < 2));
      },
      platform: 'darwin',
      uid: 501,
      unloadTimeoutMs: 5_000,
    });
    expect(await slow.uninstall()).toMatchObject({ wasLoaded: true });
    expect(calls).toEqual(['print', 'bootout', 'print', 'print']);
    const stuck = createControl({ launchd: { loaded: true, unloads: false } });
    expect(await stuck.service.uninstall()).toMatchObject({ wasLoaded: true });
    expect(stuck.launchd.calls.map((call) => call[0])).toEqual(['print', 'bootout', 'print']);
  });
});

describe('removing it', () => {
  test('boots it out and deletes the plist, and says when there was nothing to remove', async () => {
    const { service, launchd, plist } = createControl();
    await service.install();
    expect(await service.uninstall()).toEqual({ plist, wasLoaded: true, removedPlist: true });
    expect(existsSync(plist)).toBe(false);
    expect(launchd.loaded).toBe(false);
    expect(await service.uninstall()).toEqual({ plist, wasLoaded: false, removedPlist: false });
  });
});

describe('its status', () => {
  test('loaded and running, with the server it runs on this data folder', async () => {
    const { service, plist, log, dataDir } = createControl({ launchd: { loaded: true, pid: process.pid } });
    writeHolder(dataDir, process.pid);
    expect(await service.status()).toEqual({
      label: SERVICE_LABEL,
      plist,
      log,
      installed: false,
      loaded: true,
      state: 'running',
      pid: process.pid,
      lastExitCode: null,
      server: expect.objectContaining({ pid: process.pid, port: 5190, version: '0.0.0', service: true }),
    });
  });

  test('not installed, or loaded but stopped, and a server another program started', async () => {
    const missing = createControl();
    expect(await missing.service.status()).toMatchObject({
      installed: false,
      loaded: false,
      pid: null,
      server: null,
    });
    const stopped = createControl({ launchd: { loaded: true, lastExitCode: 1 } });
    writeHolder(stopped.dataDir, process.pid);
    expect(await stopped.service.status()).toMatchObject({
      loaded: true,
      state: 'not running',
      pid: null,
      lastExitCode: 1,
      server: { service: false },
    });
    const dead = createControl();
    writeHolder(dead.dataDir, 999_999);
    expect((await dead.service.status()).server).toBeNull();
  });
});

describe('restarting it', () => {
  test('kickstarts the loaded job, and refuses one that is not installed', async () => {
    const { service, launchd } = createControl({ launchd: { loaded: true, pid: 12 } });
    expect(await service.restart()).toMatchObject({ loaded: true, pid: 12 });
    expect(launchd.calls).toContainEqual(['kickstart', '-k', TARGET]);
    const missing = createControl();
    await expect(missing.service.restart()).rejects.toThrow(
      'The background service is not installed. Run `shinsa service install` first.'
    );
  });
});

describe('its log', () => {
  test('the last lines of serve.log, or none before it exists', () => {
    const { service, log, dataDir } = createControl();
    expect(service.logs(5)).toEqual({ path: log, lines: [] });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(log, 'one\ntwo\nthree\n');
    expect(service.logs(2)).toEqual({ path: log, lines: ['two', 'three'] });
    expect(service.logs(0)).toEqual({ path: log, lines: ['three'] });
    writeFileSync(log, 'no newline');
    expect(service.logs(50).lines).toEqual(['no newline']);
  });
});
