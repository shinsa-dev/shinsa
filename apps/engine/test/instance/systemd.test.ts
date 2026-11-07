import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, type FileSystem } from 'effect';
import {
  createSystemdService,
  resolveUnit,
  resolveUnitPath,
  type ServiceResult,
  SYSTEMD_UNIT,
} from '../../src/instance/index.ts';
import type { Shell } from '../../src/shell/service.ts';
import { runFiles } from '../harness.ts';
import { testRuntime } from '../helpers/runtime.ts';
import { createTempDir, removeTempDirs } from '../helpers/temp.ts';

function run<A, E>(effect: Effect.Effect<A, E, Shell | FileSystem.FileSystem>) {
  return testRuntime.runPromise(effect);
}

afterEach(removeTempDirs);

interface FakeSystemd {
  reachable?: boolean;
  linger?: ServiceResult;
  refuse?: string;
}

async function createFake(home: string, fake: FakeSystemd = {}) {
  const calls: string[][] = [];
  const service = await runFiles(
    createSystemdService({
      env: { HOME: home },
      program: '/opt/shinsa/bin/shinsa',
      user: 'dev',
      systemctl: (args) => {
        calls.push(args);
        if (args[0] === 'show-environment') return Effect.succeed({ ok: fake.reachable ?? true, output: '' });
        const refused = args[0] === fake.refuse;
        return Effect.succeed({ ok: !refused, output: refused ? 'Access denied' : '' });
      },
      loginctl: (args) => {
        calls.push(['loginctl', ...args]);
        return Effect.succeed(fake.linger ?? { ok: true, output: 'yes\n' });
      },
    })
  );
  return { service, calls, path: join(home, '.config/systemd/user', SYSTEMD_UNIT) };
}

describe('the systemd unit', () => {
  test('runs the engine as a service, starts it again after a failure and starts with the user’s manager', () => {
    expect(resolveUnit('/opt/shinsa/bin/shinsa', {})).toBe(
      [
        '[Unit]',
        'Description=Shinsa engine',
        '',
        '[Service]',
        'ExecStart="/opt/shinsa/bin/shinsa" engine',
        'Environment=SHINSA_SERVICE=1',
        'Restart=on-failure',
        'RestartSec=2',
        'TimeoutStopSec=40',
        '',
        '[Install]',
        'WantedBy=default.target',
        '',
      ].join('\n')
    );
  });

  test('carries the Shinsa folders and port it was started with, quoted for systemd', () => {
    const unit = resolveUnit('/home/a b/100%$/shinsa', {
      SHINSA_HOME: '/srv/"shinsa"',
      SHINSA_PORT: '7500',
      PATH: '/usr/bin',
    });
    expect(unit).toContain('ExecStart="/home/a b/100%%$$/shinsa" engine');
    expect(unit).toContain('Environment="SHINSA_HOME=/srv/\\"shinsa\\""');
    expect(unit).toContain('Environment="SHINSA_PORT=7500"');
    expect(unit).not.toContain('PATH');
  });

  test('lives in the user’s systemd folder, under XDG_CONFIG_HOME when it is set', () => {
    expect(resolveUnitPath({ HOME: '/home/dev' })).toBe('/home/dev/.config/systemd/user/shinsa.service');
    expect(resolveUnitPath({ HOME: '/home/dev', XDG_CONFIG_HOME: '/cfg' })).toBe(
      '/cfg/systemd/user/shinsa.service'
    );
    expect(resolveUnitPath({})).toEndWith('/.config/systemd/user/shinsa.service');
  });
});

describe('the systemd service', () => {
  test('the first start writes the unit, reloads systemd and enables it', async () => {
    const { service, calls, path } = await createFake(createTempDir());
    expect(await run(service.prepare)).toBeNull();
    expect(readFileSync(path, 'utf8')).toBe(resolveUnit('/opt/shinsa/bin/shinsa', {}));
    expect(calls).toEqual([
      ['show-environment'],
      ['daemon-reload'],
      ['enable', SYSTEMD_UNIT],
      ['loginctl', 'show-user', 'dev', '--property=Linger', '--value'],
    ]);
  });

  test('a later start leaves a current unit alone and rewrites a stale one', async () => {
    const { service, calls, path } = await createFake(createTempDir());
    await run(service.prepare);
    calls.length = 0;
    await run(service.prepare);
    expect(calls.map((call) => call[0])).toEqual(['show-environment', 'enable', 'loginctl']);
    writeFileSync(path, 'ExecStart=/old/shinsa engine\n');
    calls.length = 0;
    await run(service.prepare);
    expect(calls.map((call) => call[0])).toEqual(['show-environment', 'daemon-reload', 'enable', 'loginctl']);
    expect(readFileSync(path, 'utf8')).toContain('ExecStart="/opt/shinsa/bin/shinsa" engine');
  });

  test('says how to keep the engine running after logout when lingering is off', async () => {
    const off = await createFake(createTempDir(), { linger: { ok: true, output: 'no\n' } });
    expect(await run(off.service.prepare)).toBe(
      'It stops when you log out. To keep it running and start it at boot, turn on lingering: `sudo loginctl enable-linger dev`.'
    );
    const unknown = await createFake(createTempDir(), { linger: { ok: false, output: 'no' } });
    expect(await run(unknown.service.prepare)).toBeNull();
  });

  test('refuses where there is no user manager, and reports a systemctl that fails', async () => {
    const missing = await createFake(createTempDir(), { reachable: false });
    await expect(run(missing.service.prepare)).rejects.toThrow(
      'This machine has no systemd user manager to keep the engine running. Log in as this user over SSH rather than with `su`, or run `shinsa engine` under a process manager of your own.'
    );
    expect(existsSync(missing.path)).toBe(false);
    const denied = await createFake(createTempDir(), { refuse: 'enable' });
    await expect(run(denied.service.prepare)).rejects.toThrow('systemctl enable failed: Access denied');
  });

  test('every action goes to the unit once it is installed', async () => {
    const { service, calls } = await createFake(createTempDir());
    await expect(run(service.assertInstalled)).rejects.toThrow(
      'The engine is not set up as a service yet. `shinsa start` sets it up.'
    );
    expect(await run(service.kick)).toBe(false);
    expect(calls).toEqual([]);
    await run(service.prepare);
    calls.length = 0;
    await run(service.assertInstalled);
    await run(service.start);
    await run(service.stop);
    await run(service.kill);
    await run(service.restart);
    expect(await run(service.kick)).toBe(true);
    expect(calls).toEqual([
      ['start', SYSTEMD_UNIT],
      ['stop', '--no-block', SYSTEMD_UNIT],
      ['kill', '--signal=SIGKILL', SYSTEMD_UNIT],
      ['restart', SYSTEMD_UNIT],
      ['start', SYSTEMD_UNIT],
    ]);
    expect(service.manager).toBe('systemd');
    expect(service.revivesKilled).toBe(false);
  });
});
