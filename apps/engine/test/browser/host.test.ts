import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Exit, Scope } from 'effect';
import { Schema } from 'effect';
import {
  BrowserHostSettings,
  CHROME_EXECUTABLES,
  DevToolsActivePort,
  PROFILE_IN_USE_MESSAGE,
  SignInUrl,
} from '../../src/browser/host/schema.ts';
import { BrowserHost } from '../../src/browser/host/service.ts';
import { until } from '../helpers/until.ts';
import { startFakeCdp } from './cdp.ts';
import { awaitPid, createFakeChrome, isAlive, runHost, SHINSA, SUPERWALL } from './harness.ts';

const SIGN_IN = SignInUrl.make('https://accounts.google.com/');

describe('the browser host', () => {
  test('looks for Chrome where macOS installs it by default', () => {
    const settings = Effect.runSync(
      Effect.gen(function* () {
        return yield* BrowserHostSettings;
      })
    );
    expect(settings.executables).toBe(CHROME_EXECUTABLES);
    expect(settings.executables[0]).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  });

  test('reads and writes the port file Chrome leaves in its profile', () => {
    const decoded = Schema.decodeUnknownSync(DevToolsActivePort)('9222\n/devtools/browser/abc\n');
    expect(decoded).toEqual({ port: 9222, path: '/devtools/browser/abc' });
    expect(Schema.encodeSync(DevToolsActivePort)(decoded)).toBe('9222\n/devtools/browser/abc');
  });

  test('starts Chrome headless on the project profile once and shares it', async () => {
    const chrome = createFakeChrome();
    const [first, second, mode] = await runHost(
      chrome,
      Effect.gen(function* () {
        const host = yield* BrowserHost;
        const opened = yield* host.acquire(SHINSA);
        const reused = yield* host.acquire(SHINSA);
        return [opened, reused, yield* host.resolveMode(SHINSA)] as const;
      })
    );
    expect(first.webSocketUrl).toMatch(/^ws:\/\/127\.0\.0\.1:9222\/devtools\/browser\/fake-\d+$/);
    expect(second).toEqual(first);
    expect(mode).toBe('headless');
    const launches = chrome.launches();
    expect(launches).toHaveLength(1);
    expect(launches[0]).toContain(`--user-data-dir=${join(chrome.home, 'data', 'browser', SHINSA)}`);
    expect(launches[0]).toContain('--headless=new');
    expect(launches[0]).toContain('--use-mock-keychain');
    expect(launches[0]).toContain('--force-device-scale-factor=2');
    expect(launches[0]).toContain('--remote-debugging-address=127.0.0.1');
  });

  test('keeps one browser per project', async () => {
    const chrome = createFakeChrome();
    const [shinsa, superwall] = await runHost(
      chrome,
      Effect.gen(function* () {
        const host = yield* BrowserHost;
        return [yield* host.acquire(SHINSA), yield* host.acquire(SUPERWALL)] as const;
      })
    );
    expect(shinsa.webSocketUrl).not.toBe(superwall.webSocketUrl);
    expect(chrome.launches()).toHaveLength(2);
  });

  test('says when no Chrome is installed', async () => {
    const chrome = createFakeChrome();
    const error = await runHost(chrome, Effect.flip(BrowserHost.use((host) => host.acquire(SHINSA))), {
      executables: [join(chrome.dir, 'missing')],
    });
    expect(error).toMatchObject({ _tag: 'BrowserUnavailable', reason: 'not_installed' });
  });

  test('fails when Chrome stops before it is ready', async () => {
    const chrome = createFakeChrome();
    chrome.fail();
    const error = await runHost(chrome, Effect.flip(BrowserHost.use((host) => host.acquire(SHINSA))));
    expect(error).toMatchObject({
      reason: 'launch_failed',
      message: 'Chrome stopped with code 3 before it was ready.',
    });
  });

  test('stops Chrome and fails when it never says where it listens', async () => {
    const chrome = createFakeChrome();
    chrome.writeGarbage();
    const [error, mode] = await runHost(
      chrome,
      Effect.gen(function* () {
        const host = yield* BrowserHost;
        const failure = yield* Effect.flip(host.acquire(SHINSA));
        return [failure, yield* host.resolveMode(SHINSA)] as const;
      }),
      { launchTimeout: '300 millis' }
    );
    expect(error).toMatchObject({ reason: 'launch_failed', message: 'Chrome did not start in time.' });
    expect(mode).toBe('stopped');
    await until('the fake Chrome to stop', () => !isAlive(chrome.pidOf(SHINSA)));
  });

  test('stops an idle browser once its last user leaves', async () => {
    const chrome = createFakeChrome();
    await runHost(
      chrome,
      Effect.gen(function* () {
        const host = yield* BrowserHost;
        yield* Effect.scoped(host.acquire(SHINSA));
        const pid = chrome.pidOf(SHINSA);
        yield* Effect.promise(() =>
          until(
            'the idle browser to stop',
            async () => (await Effect.runPromise(host.resolveMode(SHINSA))) === 'stopped'
          )
        );
        yield* Effect.promise(() => until('the fake Chrome to exit', () => !isAlive(pid)));
      }),
      { idleAfter: '20 millis' }
    );
  });

  test('keeps the browser while someone uses it again after it went idle', async () => {
    const chrome = createFakeChrome();
    const mode = await runHost(
      chrome,
      Effect.gen(function* () {
        const host = yield* BrowserHost;
        yield* Effect.scoped(host.acquire(SHINSA));
        yield* host.acquire(SHINSA);
        yield* Effect.sleep('300 millis');
        return yield* host.resolveMode(SHINSA);
      }),
      { idleAfter: '20 millis' }
    );
    expect(mode).toBe('headless');
    expect(chrome.launches()).toHaveLength(1);
  });

  test('opens a plain window for signing in, shows it again on a second open, refuses agents meanwhile and hands back after', async () => {
    const chrome = createFakeChrome();
    const [refused, during, after] = await runHost(
      chrome,
      Effect.gen(function* () {
        const host = yield* BrowserHost;
        const scope = yield* Scope.make();
        yield* Scope.provide(host.acquire(SHINSA), scope);
        const headless = chrome.pidOf(SHINSA);
        yield* host.openWindow(SHINSA, SIGN_IN);
        yield* awaitPid(chrome, SHINSA, headless);
        yield* host.openWindow(SHINSA, SIGN_IN);
        const refusal = yield* Effect.flip(host.acquire(SHINSA));
        const signingIn = yield* host.resolveMode(SHINSA);
        yield* Scope.close(scope, Exit.void);
        yield* host.closeWindow(SHINSA);
        yield* host.closeWindow(SHINSA);
        yield* host.acquire(SHINSA);
        return [refusal, signingIn, yield* host.resolveMode(SHINSA)] as const;
      })
    );
    expect(refused).toMatchObject({ reason: 'signing_in' });
    expect(during).toBe('window');
    expect(after).toBe('headless');
    const launches = chrome.launches();
    expect(launches).toHaveLength(4);
    expect(launches[2]).not.toContain('--headless');
    expect(launches[2]?.endsWith(SIGN_IN)).toBe(true);
    expect(launches[3]).toContain('--headless=new');
    expect(launches[1]).not.toContain('--headless');
    expect(launches[1]).not.toContain('remote-debugging');
    expect(launches[1]).toContain('--use-mock-keychain');
    expect(launches[1]?.endsWith(SIGN_IN)).toBe(true);
    expect(chrome.handoffs()).toEqual(launches.slice(2, 3));
  });

  test('waits for a slow hand-off to the open window before closing it, so no second window starts', async () => {
    const chrome = createFakeChrome();
    chrome.slowHandoff();
    const mode = await runHost(
      chrome,
      Effect.gen(function* () {
        const host = yield* BrowserHost;
        yield* host.openWindow(SHINSA, SIGN_IN);
        yield* awaitPid(chrome, SHINSA);
        yield* host.openWindow(SHINSA, SIGN_IN);
        yield* host.closeWindow(SHINSA);
        yield* host.acquire(SHINSA);
        return yield* host.resolveMode(SHINSA);
      })
    );
    expect(mode).toBe('headless');
    const launches = chrome.launches();
    expect(launches).toHaveLength(3);
    expect(chrome.handoffs()).toEqual(launches.slice(1, 2));
    expect(launches[2]).toContain('--headless=new');
  });

  test('forgets a browser that quits on its own', async () => {
    const chrome = createFakeChrome();
    await runHost(
      chrome,
      Effect.gen(function* () {
        const host = yield* BrowserHost;
        yield* host.openWindow(SHINSA, SIGN_IN);
        process.kill(yield* awaitPid(chrome, SHINSA), 'SIGTERM');
        yield* Effect.promise(() =>
          until(
            'the quit window to be forgotten',
            async () => (await Effect.runPromise(host.resolveMode(SHINSA))) === 'stopped'
          )
        );
      })
    );
  });

  test('stops a browser, and signs out of everything by removing its profile', async () => {
    const chrome = createFakeChrome();
    const profile = join(chrome.home, 'data', 'browser', SHINSA);
    await runHost(
      chrome,
      Effect.gen(function* () {
        const host = yield* BrowserHost;
        yield* host.acquire(SHINSA);
        yield* host.stop(SHINSA);
        expect(yield* host.resolveMode(SHINSA)).toBe('stopped');
        expect(existsSync(profile)).toBe(true);
        expect(host.resolveProfilePath(SHINSA)).toBe(profile);
        yield* host.acquire(SHINSA);
        yield* host.remove(SHINSA);
        expect(yield* host.resolveMode(SHINSA)).toBe('stopped');
      })
    );
    expect(existsSync(profile)).toBe(false);
  });

  test('asks Chrome to close itself first, so it writes its cookies to disk', async () => {
    const chrome = createFakeChrome();
    const cdp = startFakeCdp({ onBrowserClose: () => process.kill(chrome.pidOf(SHINSA), 'SIGKILL') });
    chrome.listenOn(cdp.port);
    const started = Date.now();
    await runHost(
      chrome,
      Effect.gen(function* () {
        const host = yield* BrowserHost;
        yield* Effect.scoped(host.acquire(SHINSA));
        yield* host.stop(SHINSA);
      })
    );
    cdp.stop();
    expect(cdp.received.map((text) => JSON.parse(text).method)).toEqual(['Browser.close']);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  test('stops every browser when the engine stops', async () => {
    const chrome = createFakeChrome();
    const pids = await runHost(
      chrome,
      Effect.gen(function* () {
        const host = yield* BrowserHost;
        yield* host.acquire(SHINSA);
        yield* host.openWindow(SUPERWALL, SIGN_IN);
        return [chrome.pidOf(SHINSA), yield* awaitPid(chrome, SUPERWALL)];
      })
    );
    for (const pid of pids) expect(isAlive(pid)).toBe(false);
  });

  test('stops a sign-in window an earlier engine left on the profile, then starts its own', async () => {
    const chrome = createFakeChrome();
    const orphan = chrome.startOrphan(SHINSA, 'window');
    await Effect.runPromise(awaitPid(chrome, SHINSA));
    const endpoint = await runHost(
      chrome,
      BrowserHost.use((host) => host.acquire(SHINSA))
    );
    expect(isAlive(orphan)).toBe(false);
    expect(endpoint.webSocketUrl).not.toContain(`fake-${orphan}`);
    expect(chrome.launches()).toHaveLength(2);
  });

  test('names the process when something else holds the profile, and starts nothing', async () => {
    const chrome = createFakeChrome();
    const other = Bun.spawn(['sleep', '30'], { stdio: ['ignore', 'ignore', 'ignore'] });
    chrome.lockProfile(SHINSA, other.pid);
    const error = await runHost(chrome, Effect.flip(BrowserHost.use((host) => host.acquire(SHINSA))));
    other.kill();
    expect(error).toMatchObject({
      reason: 'profile_in_use',
      message: `Another program (process ${other.pid}) has this project's browser folder open. Quit it and try again.`,
    });
    expect(chrome.launches()).toHaveLength(0);
  });

  test('leaves a lock whose process is gone to Chrome', async () => {
    const chrome = createFakeChrome();
    const gone = Bun.spawn(['true']);
    await gone.exited;
    chrome.lockProfile(SHINSA, gone.pid);
    await runHost(
      chrome,
      BrowserHost.use((host) => host.acquire(SHINSA))
    );
    expect(chrome.launches()).toHaveLength(1);
  });

  test('stops a Chrome an earlier engine left under an earlier host name', async () => {
    const chrome = createFakeChrome();
    const orphan = chrome.startOrphan(SHINSA, 'window');
    await Effect.runPromise(awaitPid(chrome, SHINSA));
    chrome.renameLockHost(SHINSA, 'old-mac.local');
    await runHost(
      chrome,
      BrowserHost.use((host) => host.acquire(SHINSA))
    );
    expect(isAlive(orphan)).toBe(false);
    expect(chrome.launches()).toHaveLength(2);
  });

  test('clears a lock left under an earlier host name whose process is gone', async () => {
    const chrome = createFakeChrome();
    const gone = Bun.spawn(['true']);
    await gone.exited;
    chrome.lockProfile(SHINSA, gone.pid, 'old-mac.local');
    const mode = await runHost(
      chrome,
      Effect.gen(function* () {
        const host = yield* BrowserHost;
        yield* host.acquire(SHINSA);
        return yield* host.resolveMode(SHINSA);
      })
    );
    expect(mode).toBe('headless');
    expect(chrome.launches()).toHaveLength(1);
  });

  test('starts again once when Chrome finds the profile in use', async () => {
    const chrome = createFakeChrome();
    chrome.busyOnce();
    const mode = await runHost(
      chrome,
      Effect.gen(function* () {
        const host = yield* BrowserHost;
        yield* host.acquire(SHINSA);
        return yield* host.resolveMode(SHINSA);
      })
    );
    expect(mode).toBe('headless');
    expect(chrome.launches()).toHaveLength(2);
  });

  test('says the profile is in use when Chrome still refuses it after starting again', async () => {
    const chrome = createFakeChrome();
    chrome.busy();
    const error = await runHost(chrome, Effect.flip(BrowserHost.use((host) => host.acquire(SHINSA))));
    expect(error).toMatchObject({ reason: 'profile_in_use', message: PROFILE_IN_USE_MESSAGE });
    expect(chrome.launches()).toHaveLength(2);
  });

  test('stops the headless Chromes earlier engines left when it starts, and leaves sign-in windows', async () => {
    const chrome = createFakeChrome();
    const headless = chrome.startOrphan(SHINSA);
    await Effect.runPromise(awaitPid(chrome, SHINSA));
    const window = chrome.startOrphan(SUPERWALL, 'window');
    await Effect.runPromise(awaitPid(chrome, SUPERWALL));
    await runHost(
      chrome,
      Effect.promise(() => until('the left headless Chrome to stop', () => !isAlive(headless)))
    );
    expect(isAlive(window)).toBe(true);
    process.kill(window);
  });

  test('starts no browser of its own while it stops the ones left behind', async () => {
    const chrome = createFakeChrome();
    const orphan = chrome.startOrphan(SHINSA);
    await Effect.runPromise(awaitPid(chrome, SHINSA));
    const mode = await runHost(
      chrome,
      Effect.gen(function* () {
        const host = yield* BrowserHost;
        yield* host.acquire(SHINSA);
        return yield* host.resolveMode(SHINSA);
      })
    );
    expect(isAlive(orphan)).toBe(false);
    expect(mode).toBe('headless');
    expect(chrome.launches()).toHaveLength(2);
  });
});
