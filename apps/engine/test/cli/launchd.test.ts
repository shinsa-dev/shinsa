import { describe, expect, test } from 'bun:test';
import { createLaunchdService } from '../../src/cli/launchd.ts';

const TARGET = 'gui/501/studio.overclock.shinsa.engine';

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
});
