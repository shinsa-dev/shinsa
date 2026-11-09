import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BunServices } from '@effect/platform-bun';
import { type Duration, Effect, Layer, type Scope } from 'effect';
import { BrowserProfile, BrowserHostSettings } from '../../src/browser/host/schema.ts';
import { BrowserHost } from '../../src/browser/host/service.ts';
import { EngineConfig } from '../../src/config/service.ts';
import { createConfigAt } from '../helpers/config.ts';
import { createTempDir } from '../helpers/temp.ts';
import { until } from '../helpers/until.ts';

export const SHINSA = BrowserProfile.make('01a1c0c1-shinsa');
export const SUPERWALL = BrowserProfile.make('01a1c0c1-superwall');

const FAKE_CHROME = `#!/bin/sh
here="$(dirname "$0")"
for arg in "$@"; do case "$arg" in --user-data-dir=*) profile="\${arg#--user-data-dir=}";; esac; done
echo "$*" >> "$here/launches"
echo $$ > "$profile/pid"
[ -f "$here/fail" ] && exit 3
case "$*" in *--headless=new*)
  if [ -f "$here/garbage" ]; then echo "not a port" > "$profile/DevToolsActivePort"; else printf '9222\\n/devtools/browser/fake-%s\\n' "$$" > "$profile/DevToolsActivePort"; fi;;
esac
exec sleep 30
`;

export interface FakeChrome {
  readonly dir: string;
  readonly path: string;
  readonly home: string;
  launches(): string[];
  pidOf(profile: BrowserProfile): number;
  fail(): void;
  writeGarbage(): void;
}

export function createFakeChrome(): FakeChrome {
  const dir = createTempDir('shinsa-chrome-');
  const home = createTempDir('shinsa-home-');
  const path = join(dir, 'chrome');
  writeFileSync(path, FAKE_CHROME);
  chmodSync(path, 0o755);
  return {
    dir,
    path,
    home,
    launches: () => {
      const file = join(dir, 'launches');
      return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n') : [];
    },
    pidOf: (profile) => Number(readFileSync(join(home, 'browser', profile, 'pid'), 'utf8').trim()),
    fail: () => writeFileSync(join(dir, 'fail'), ''),
    writeGarbage: () => writeFileSync(join(dir, 'garbage'), ''),
  };
}

export interface HostOptions {
  readonly executables?: ReadonlyArray<string>;
  readonly idleAfter?: Duration.Input;
  readonly launchTimeout?: Duration.Input;
}

export function runHost<A, E>(
  chrome: FakeChrome,
  effect: Effect.Effect<A, E, BrowserHost | Scope.Scope>,
  options: HostOptions = {}
) {
  const layer = BrowserHost.layer.pipe(
    Layer.provide(Layer.succeed(EngineConfig, createConfigAt(chrome.home))),
    Layer.provide(
      Layer.succeed(BrowserHostSettings, {
        executables: options.executables ?? [join(chrome.dir, 'missing'), chrome.path],
        idleAfter: options.idleAfter ?? '1 hour',
        launchTimeout: options.launchTimeout ?? '5 seconds',
        stopTimeout: '2 seconds',
      })
    ),
    Layer.provide(BunServices.layer)
  );
  return Effect.runPromise(Effect.scoped(Effect.provide(effect, layer)));
}

export function awaitLaunches(chrome: FakeChrome, count: number) {
  return Effect.promise(() => until(`${count} launches of Chrome`, () => chrome.launches().length >= count));
}

export function awaitPid(chrome: FakeChrome, profile: BrowserProfile) {
  return Effect.promise(async () => {
    await until('Chrome to write its pid', () => existsSync(join(chrome.home, 'browser', profile, 'pid')));
    return chrome.pidOf(profile);
  });
}

export function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
