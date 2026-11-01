import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLaunchdService, isAppJob, resolveLaunchAgent } from '../../src/cli/launchd.ts';
import type { ServiceRunner } from '../../src/instance/index.ts';
import { createTempDir } from '../helpers/index.ts';

const TARGET = 'gui/501/studio.overclock.shinsa.engine';

const PROGRAM = '/Users/dev/.local/share/shinsa/bin/shinsa';

const APP_JOB = [
  'program identifier = Contents/Resources/engine/bin/shinsa (mode: 2)',
  'parent bundle identifier = studio.overclock.shinsa',
].join('\n');

function createFakeLaunchctl(printed: string | null) {
  const calls: string[][] = [];
  const launchctl: ServiceRunner = (args) => {
    calls.push(args);
    if (args[0] === 'print') return Promise.resolve({ ok: printed !== null, output: printed ?? '' });
    return Promise.resolve({ ok: true, output: '' });
  };
  return { calls, launchctl };
}

function createStandalone(printed: string | null, ownsJob = (output: string) => output.includes(PROGRAM)) {
  const home = createTempDir();
  const fake = createFakeLaunchctl(printed);
  const service = createLaunchdService({
    uid: 501,
    launchctl: fake.launchctl,
    ownsJob,
    inApp: false,
    program: PROGRAM,
    home,
    env: { SHINSA_PORT: '7450', SHINSA_HOME: '/srv/shinsa', PATH: '/usr/bin' },
  });
  const plist = join(home, 'Library', 'LaunchAgents', 'studio.overclock.shinsa.engine.plist');
  return { ...fake, service, plist };
}

describe('the launchd service', () => {
  test('wakes only the job this app owns', async () => {
    const calls: string[][] = [];
    const launchctl = (args: string[]) => {
      calls.push(args);
      return Promise.resolve({ ok: true, output: 'program = /Applications/Shinsa.app/x' });
    };
    expect(await createLaunchdService({ uid: 501, launchctl, ownsJob: () => false }).kick()).toBe(false);
    expect(calls).toEqual([['print', TARGET]]);
    const owned = createLaunchdService({ uid: 501, launchctl, ownsJob: () => true });
    expect(await owned.kick()).toBe(true);
    expect(calls.slice(1)).toEqual([
      ['print', TARGET],
      ['kickstart', TARGET],
    ]);
    const missing = createLaunchdService({
      uid: 501,
      launchctl: () => Promise.resolve({ ok: false, output: '' }),
      ownsJob: () => true,
    });
    expect(await missing.kick()).toBe(false);
    expect(owned.manager).toBe('launchd');
    expect(owned.revivesKilled).toBe(true);
  });

  test('the shinsa inside the app only starts the job the app set up', async () => {
    const missing = createLaunchdService({
      uid: 501,
      launchctl: createFakeLaunchctl(null).launchctl,
      ownsJob: () => true,
    });
    await expect(missing.prepare()).rejects.toThrow('Open the Shinsa app once and it sets it up.');
    const fake = createFakeLaunchctl(APP_JOB);
    const set = createLaunchdService({ uid: 501, launchctl: fake.launchctl, ownsJob: () => true });
    expect(await set.prepare()).toBeNull();
    expect(fake.calls).toEqual([['print', TARGET]]);
    const other = createLaunchdService({ uid: 501, launchctl: fake.launchctl, ownsJob: () => false });
    await expect(other.assertInstalled()).rejects.toThrow('is not the one inside the Shinsa app');
  });
});

describe('the engine on a Mac without the app', () => {
  test('writes and loads its own agent under the app’s label, carrying where its data lives', async () => {
    const { service, calls, plist } = createStandalone(null);
    expect(await service.prepare()).toBeNull();
    expect(calls).toEqual([
      ['print', TARGET],
      ['bootstrap', 'gui/501', plist],
    ]);
    const agent = readFileSync(plist, 'utf8');
    expect(agent).toBe(
      resolveLaunchAgent('studio.overclock.shinsa.engine', PROGRAM, {
        SHINSA_PORT: '7450',
        SHINSA_HOME: '/srv/shinsa',
      })
    );
    expect(agent).toContain(`<string>${PROGRAM}</string>`);
    expect(agent).toContain('<key>SHINSA_SERVICE</key>\n    <string>1</string>');
    expect(agent).toContain('<key>SHINSA_PORT</key>\n    <string>7450</string>');
    expect(agent).not.toContain('PATH');
    expect(agent).toContain('<key>SuccessfulExit</key>\n    <false/>');
    expect(agent).toContain('<key>RunAtLoad</key>\n  <true/>');
  });

  test('leaves a loaded agent that is already current, and replaces a stale one', async () => {
    const current = createStandalone(`program = ${PROGRAM}`);
    await current.service.prepare();
    const written = readFileSync(current.plist, 'utf8');
    current.calls.length = 0;
    await current.service.prepare();
    expect(current.calls).toEqual([['print', TARGET]]);
    writeFileSync(current.plist, written.replace(PROGRAM, '/old/shinsa'));
    await current.service.prepare();
    expect(current.calls.slice(1)).toEqual([
      ['print', TARGET],
      ['bootout', TARGET],
      ['bootstrap', 'gui/501', current.plist],
    ]);
    expect(readFileSync(current.plist, 'utf8')).toBe(written);
  });

  test('takes over the job another standalone shinsa set up', async () => {
    const { service, calls, plist } = createStandalone('program = /old/bin/shinsa');
    await expect(service.assertInstalled()).rejects.toThrow('Another shinsa set up the engine on this Mac');
    await service.prepare();
    expect(calls.slice(1)).toEqual([
      ['print', TARGET],
      ['bootout', TARGET],
      ['bootstrap', 'gui/501', plist],
    ]);
  });

  test('never starts a second engine beside the app’s', async () => {
    const { service, calls, plist } = createStandalone(APP_JOB);
    await expect(service.prepare()).rejects.toThrow('does not start a second one on the same port');
    await expect(service.assertInstalled()).rejects.toThrow('The Shinsa app runs the engine on this Mac');
    expect(calls.every(([verb]) => verb === 'print')).toBe(true);
    expect(existsSync(plist)).toBe(false);
    const owned = createStandalone(APP_JOB, () => true);
    expect(await owned.service.prepare()).toBeNull();
    expect(existsSync(owned.plist)).toBe(false);
  });

  test('says `shinsa start` sets it up when nothing is loaded', async () => {
    await expect(createStandalone(null).service.assertInstalled()).rejects.toThrow(
      'The engine is not set up yet. `shinsa start` sets it up.'
    );
  });

  test('tells the app’s jobs from a program on its own, and escapes what it writes', () => {
    expect(isAppJob(APP_JOB)).toBe(true);
    expect(isAppJob('program = /Applications/Shinsa.app/Contents/Resources/engine/bin/shinsa')).toBe(true);
    expect(isAppJob(`program = ${PROGRAM}`)).toBe(false);
    expect(isAppJob('')).toBe(false);
    expect(resolveLaunchAgent('a', '/tmp/R&D <x>/shinsa', {})).toContain(
      '<string>/tmp/R&amp;D &lt;x&gt;/shinsa</string>'
    );
  });
});
