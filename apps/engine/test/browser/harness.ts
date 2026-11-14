import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
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

const FAKE_CHROME = `#!/bin/bash
here="$(dirname "$0")"
for arg in "$@"; do case "$arg" in --user-data-dir=*) profile="\${arg#--user-data-dir=}";; esac; done
echo "$*" >> "$here/launches"
case "$*" in *--headless=new*) ;; *)
  [ -f "$here/slow-handoff" ] && sleep 0.3
  [ -f "$profile/pid" ] && kill -0 "$(cat "$profile/pid")" 2>/dev/null && echo "$*" >> "$here/handoffs" && exit 0;;
esac
[ -f "$here/busy" ] && exit 21
[ -f "$here/busy-once" ] && rm "$here/busy-once" && exit 21
holder="$(readlink "$profile/SingletonLock" 2>/dev/null)"
[ -n "$holder" ] && [ "\${holder%-*}" != "$(hostname)" ] && exit 21
[ -n "$holder" ] && kill -0 "\${holder##*-}" 2>/dev/null && exit 21
ln -sfn "$(hostname)-$$" "$profile/SingletonLock"
echo $$ > "$profile/pid"
[ -f "$here/fail" ] && exit 3
case "$*" in *--headless=new*)
  port=9222; [ -f "$here/port" ] && port="$(cat "$here/port")"
  if [ -f "$here/garbage" ]; then echo "not a port" > "$profile/DevToolsActivePort"; else printf '%s\\n/devtools/browser/fake-%s\\n' "$port" "$$" > "$profile/DevToolsActivePort"; fi;;
esac
exec -a "$0 $*" sleep 30
`;

export interface FakeChrome {
  readonly dir: string;
  readonly path: string;
  readonly home: string;
  launches(): string[];
  handoffs(): string[];
  pidOf(profile: BrowserProfile): number;
  fail(): void;
  writeGarbage(): void;
  listenOn(port: number): void;
  busy(): void;
  busyOnce(): void;
  slowHandoff(): void;
  lockProfile(profile: BrowserProfile, pid: number, host?: string): void;
  renameLockHost(profile: BrowserProfile, host: string): void;
  startOrphan(profile: BrowserProfile, mode?: 'headless' | 'window'): number;
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
    handoffs: () => {
      const file = join(dir, 'handoffs');
      return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n') : [];
    },
    pidOf: (profile) => Number(readFileSync(join(home, 'data', 'browser', profile, 'pid'), 'utf8').trim()),
    fail: () => writeFileSync(join(dir, 'fail'), ''),
    writeGarbage: () => writeFileSync(join(dir, 'garbage'), ''),
    listenOn: (port) => writeFileSync(join(dir, 'port'), String(port)),
    busy: () => writeFileSync(join(dir, 'busy'), ''),
    busyOnce: () => writeFileSync(join(dir, 'busy-once'), ''),
    slowHandoff: () => writeFileSync(join(dir, 'slow-handoff'), ''),
    lockProfile: (profile, pid, host = hostname()) => {
      const folder = join(home, 'data', 'browser', profile);
      mkdirSync(folder, { recursive: true });
      symlinkSync(`${host}-${pid}`, join(folder, 'SingletonLock'));
    },
    renameLockHost: (profile, host) => {
      const lock = join(home, 'data', 'browser', profile, 'SingletonLock');
      const pid = readlinkSync(lock).split('-').at(-1);
      rmSync(lock);
      symlinkSync(`${host}-${pid}`, lock);
    },
    startOrphan: (profile, mode = 'headless') => {
      const folder = join(home, 'data', 'browser', profile);
      mkdirSync(folder, { recursive: true });
      const args = mode === 'headless' ? ['--headless=new', 'about:blank'] : ['https://accounts.google.com/'];
      const orphan = Bun.spawn([path, `--user-data-dir=${folder}`, ...args], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      return orphan.pid;
    },
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

export function awaitPid(chrome: FakeChrome, profile: BrowserProfile, replacing?: number) {
  return Effect.promise(async () => {
    await until(
      'Chrome to write its pid',
      () =>
        existsSync(join(chrome.home, 'data', 'browser', profile, 'pid')) &&
        chrome.pidOf(profile) !== replacing
    );
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
