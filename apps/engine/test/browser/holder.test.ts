import { describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { BunServices } from '@effect/platform-bun';
import { Effect, Option } from 'effect';
import {
  isHeadless,
  isOpenedOn,
  parseProfileLock,
  resolveProfileHolder,
  stopProfileHolder,
} from '../../src/browser/host/holder.ts';
import { createTempDir } from '../helpers/temp.ts';

const LAUNCHD = 1;

function lockedFolder(target: string) {
  const folder = join(createTempDir('shinsa-profile-'), 'profile');
  mkdirSync(folder);
  symlinkSync(target, join(folder, 'SingletonLock'));
  return folder;
}

const runPlatform = <A, E>(effect: Effect.Effect<A, E, BunServices.BunServices>) =>
  Effect.runPromise(Effect.provide(effect, BunServices.layer));

describe("a browser profile's lock holder", () => {
  test('reads the host and process from the lock Chrome leaves', () => {
    expect(parseProfileLock('Mac.local-15747')).toEqual(Option.some({ host: 'Mac.local', pid: 15747 }));
    expect(parseProfileLock('my-mac.local-8\n')).toEqual(Option.some({ host: 'my-mac.local', pid: 8 }));
    expect(parseProfileLock('15747')).toEqual(Option.none());
    expect(parseProfileLock('Mac.local-')).toEqual(Option.none());
  });

  test('counts a command line as ours only when it opens exactly that folder', () => {
    const folder = '/data/browser/a';
    expect(isOpenedOn(`chrome --user-data-dir=${folder} --headless=new`, folder)).toBe(true);
    expect(isOpenedOn(`chrome --user-data-dir=${folder}\n`, folder)).toBe(true);
    expect(isOpenedOn(`chrome --user-data-dir=${folder}-b --headless=new`, folder)).toBe(false);
    expect(isOpenedOn('', folder)).toBe(false);
  });

  test('tells a headless Chrome from a sign-in window by its command line', () => {
    expect(isHeadless('chrome --user-data-dir=/data/browser/a --headless=new about:blank')).toBe(true);
    expect(isHeadless('chrome --user-data-dir=/data/browser/a https://accounts.google.com/')).toBe(false);
    expect(isHeadless('chrome --headless=old')).toBe(false);
  });

  test('ignores a lock from another machine or from this process', async () => {
    const elsewhere = lockedFolder(`another-mac-${process.pid}`);
    const mine = lockedFolder(`${hostname()}-${process.pid}`);
    const unlocked = join(createTempDir('shinsa-profile-'), 'profile');
    const holders = await runPlatform(
      Effect.all([
        resolveProfileHolder(elsewhere),
        resolveProfileHolder(mine),
        resolveProfileHolder(unlocked),
      ])
    );
    expect(holders).toEqual([{ kind: 'none' }, { kind: 'none' }, { kind: 'none' }]);
  });

  test('says the profile is in use when its holder cannot be stopped', async () => {
    const error = await runPlatform(Effect.flip(stopProfileHolder(LAUNCHD, '50 millis')));
    expect(error).toMatchObject({ reason: 'profile_in_use', message: expect.stringContaining('process 1)') });
  });
});
