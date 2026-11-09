import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BunServices } from '@effect/platform-bun';
import type { SourceBrowserId } from '@shinsa/core/engine-api/schema';
import { Effect, Layer, type Scope } from 'effect';
import { createCookieKey, decryptCookieValue } from '../../src/browser/cookies/decrypt.ts';
import { resolveCookieParam } from '../../src/browser/cookies/params.ts';
import { KEYCHAIN_REFUSED_MESSAGE, type StoredCookieRow } from '../../src/browser/cookies/schema.ts';
import { BrowserCookies } from '../../src/browser/cookies/service.ts';
import { isOnSites, listBrowserSites, resolveSite } from '../../src/browser/cookies/sites.ts';
import { BrowserUnavailable } from '../../src/browser/host/schema.ts';
import { BrowserHost } from '../../src/browser/host/service.ts';
import { EngineConfig } from '../../src/config/service.ts';
import { CommandNotFound, type CommandRequest } from '../../src/shell/schema.ts';
import { Shell } from '../../src/shell/service.ts';
import { createConfigAt } from '../helpers/config.ts';
import { createTempDir } from '../helpers/temp.ts';
import { type FakeCdp, startFakeCdp } from './cdp.ts';
import {
  DIA_PASSWORD,
  encryptCookieValue,
  toChromiumTime,
  writeCookieDatabase,
  writeDiaCookies,
} from './cookie-source.ts';
import { SHINSA } from './harness.ts';

const NOW = 1_800_000_000;

const servers: FakeCdp[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});

function createRow(overrides: Partial<StoredCookieRow> = {}): StoredCookieRow {
  return {
    hostKey: '.github.com',
    topFrameSiteKey: '',
    name: 'user_session',
    value: '',
    encryptedValue: new Uint8Array(),
    path: '/',
    expiresUtc: toChromiumTime(NOW + 3600),
    isSecure: 1,
    isHttponly: 1,
    isPersistent: 1,
    priority: 1,
    samesite: 1,
    ...overrides,
  };
}

interface CookiesOptions {
  readonly keychain?: 'allowed' | 'refused' | 'empty' | 'failed';
  readonly plutilFails?: boolean;
  readonly defaultBundle?: string | null;
  readonly unavailable?: boolean;
  readonly inspect?: boolean;
}

function runCookies<A, E>(
  userHome: string,
  effect: Effect.Effect<A, E, BrowserCookies | Scope.Scope>,
  options: CookiesOptions = {}
) {
  const cdp = startFakeCdp();
  servers.push(cdp);
  const commands: CommandRequest[] = [];
  const profiles = join(userHome, 'profiles');
  const shell = Layer.succeed(Shell, {
    run: (request) =>
      Effect.suspend(() => {
        commands.push(request);
        const [program] = request.argv;
        const failed =
          (program === 'plutil' && options.plutilFails) ||
          (program === 'security' && options.keychain === 'failed');
        if (failed)
          return Effect.fail(
            new CommandNotFound({ command: program ?? '', message: `${program} could not run` })
          );
        if (program === 'plutil') {
          const handlers =
            options.defaultBundle === null
              ? 'not json'
              : JSON.stringify([
                  { LSHandlerURLScheme: 'mailto', LSHandlerRoleAll: 'com.apple.mail' },
                  {
                    LSHandlerURLScheme: 'https',
                    LSHandlerRoleAll: options.defaultBundle ?? 'company.thebrowser.dia',
                  },
                ]);
          return Effect.succeed({ ok: true, code: 0, stdout: handlers, stderr: '', timedOut: false });
        }
        const keychain = options.keychain ?? 'allowed';
        return Effect.succeed({
          ok: keychain !== 'refused',
          code: keychain === 'refused' ? 51 : 0,
          stdout: keychain === 'allowed' ? `${DIA_PASSWORD}\n` : '',
          stderr: '',
          timedOut: false,
        });
      }),
    stopTree: () => Effect.void,
  });
  const acquired: string[] = [];
  const host = Layer.succeed(BrowserHost, {
    acquire: (profile) =>
      Effect.sync(() => acquired.push(profile)).pipe(
        Effect.andThen(() =>
          options.unavailable
            ? Effect.fail(new BrowserUnavailable({ reason: 'not_installed', message: 'No Chrome.' }))
            : Effect.succeed({ webSocketUrl: cdp.url })
        )
      ),
    openWindow: () => Effect.void,
    closeWindow: () => Effect.void,
    stop: () => Effect.void,
    remove: () => Effect.void,
    resolveMode: () => Effect.succeed('stopped' as const),
    resolveProfilePath: (profile) => join(profiles, profile),
  });
  const layer = BrowserCookies.layer.pipe(
    Layer.provide(Layer.mergeAll(shell, host)),
    Layer.provide(
      Layer.succeed(
        EngineConfig,
        createConfigAt(createTempDir(), { userHome, inspect: options.inspect ?? false })
      )
    ),
    Layer.provide(BunServices.layer)
  );
  return Effect.runPromise(Effect.scoped(Effect.provide(effect, layer))).then((value) => ({
    value,
    cdp,
    commands,
    acquired,
  }));
}

describe('decrypting a Chromium cookie', () => {
  const key = createCookieKey(DIA_PASSWORD);

  test('reads a value signed with its host, as Chromium 24 and later store it', () => {
    expect(
      decryptCookieValue(key, encryptCookieValue(DIA_PASSWORD, 'abc', '.github.com'), '.github.com')
    ).toBe('abc');
  });

  test('reads a value from an older database without the host digest', () => {
    expect(
      decryptCookieValue(key, encryptCookieValue(DIA_PASSWORD, 'abc', '.github.com', false), '.github.com')
    ).toBe('abc');
  });

  test('gives up on a value that is not v10, or made with another key', () => {
    expect(decryptCookieValue(key, new TextEncoder().encode('v11garbage'), 'x')).toBeNull();
    expect(decryptCookieValue(key, encryptCookieValue('another password', 'abc', 'x'), 'x')).toBeNull();
  });
});

describe('grouping cookies into sites', () => {
  test('names a site by its registrable domain', () => {
    expect(resolveSite('.accounts.google.com')).toBe('google.com');
    expect(resolveSite('www.bbc.co.uk')).toBe('bbc.co.uk');
    expect(resolveSite('my-app.vercel.app')).toBe('my-app.vercel.app');
    expect(resolveSite('localhost')).toBe('localhost');
    expect(resolveSite('127.0.0.1')).toBe('127.0.0.1');
    expect(resolveSite('GitHub.com')).toBe('github.com');
    expect(isOnSites('.api.github.com', new Set(['github.com']))).toBe(true);
    expect(isOnSites('.gitlab.com', new Set(['github.com']))).toBe(false);
  });

  test('puts signed-in sites first and does not count bot, load balancer or cross-site ad cookies as a sign-in', () => {
    const sites = listBrowserSites([
      { host: '.workos.com', name: '__cf_bm', httpOnly: true, crossSite: false },
      { host: '.workos.com', name: '_ga', httpOnly: false, crossSite: false },
      { host: '.workos.com', name: '_gid', httpOnly: false, crossSite: false },
      { host: '.github.com', name: 'user_session', httpOnly: true, crossSite: false },
      { host: 'a.com', name: 'x', httpOnly: false, crossSite: false },
      { host: 'b.com', name: 'x', httpOnly: false, crossSite: false },
      { host: '.rubiconproject.com', name: 'audit', httpOnly: true, crossSite: true },
    ]);
    expect(sites).toEqual([
      { site: 'github.com', cookies: 1, signedIn: true },
      { site: 'workos.com', cookies: 3, signedIn: false },
      { site: 'a.com', cookies: 1, signedIn: false },
      { site: 'b.com', cookies: 1, signedIn: false },
      { site: 'rubiconproject.com', cookies: 1, signedIn: false },
    ]);
  });
});

describe('turning a stored cookie into one Chrome takes', () => {
  test('keeps a domain cookie on its domain, with its flags and expiry', () => {
    expect(resolveCookieParam(createRow(), 'secret', NOW)).toEqual({
      name: 'user_session',
      value: 'secret',
      domain: '.github.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      expires: NOW + 3600,
      priority: 'Medium',
    });
  });

  test('keeps a host-only cookie on its host by giving its address', () => {
    const param = resolveCookieParam(
      createRow({ hostKey: 'localhost', isSecure: 0, samesite: -1, path: '/app', priority: 9 }),
      'v',
      NOW
    );
    expect(param).toMatchObject({ url: 'http://localhost/app', secure: false, priority: 'Medium' });
    expect(param).not.toHaveProperty('domain');
    expect(param).not.toHaveProperty('sameSite');
  });

  test('gives a session cookie two weeks, so it outlives the browser stopping', () => {
    expect(resolveCookieParam(createRow({ isPersistent: 0, expiresUtc: 0 }), 'v', NOW)?.expires).toBe(
      NOW + 14 * 86_400
    );
  });

  test('skips expired and partitioned cookies, and SameSite None without Secure', () => {
    expect(resolveCookieParam(createRow({ expiresUtc: toChromiumTime(NOW - 1) }), 'v', NOW)).toBeNull();
    expect(resolveCookieParam(createRow({ topFrameSiteKey: 'https://a.com' }), 'v', NOW)).toBeNull();
    expect(resolveCookieParam(createRow({ samesite: 0, isSecure: 0 }), 'v', NOW)).toBeNull();
    expect(resolveCookieParam(createRow({ samesite: 0 }), 'v', NOW)?.sameSite).toBe('None');
  });
});

describe('copying sign-ins from your browser', () => {
  test('lists the browsers that keep cookies here, your default first', async () => {
    const home = createTempDir();
    writeDiaCookies(home, []);
    writeCookieDatabase(join(home, 'Library/Application Support/Google/Chrome/Default/Network/Cookies'), []);
    const { value } = await runCookies(
      home,
      BrowserCookies.use((cookies) => cookies.listSources),
      {
        defaultBundle: 'com.google.chrome',
      }
    );
    expect(value).toEqual([
      { id: 'chrome', name: 'Google Chrome', isDefault: true },
      { id: 'dia', name: 'Dia', isDefault: false },
    ]);
  });

  test('still lists the browsers when the default one cannot be read', async () => {
    const home = createTempDir();
    writeDiaCookies(home, []);
    const { value } = await runCookies(
      home,
      BrowserCookies.use((cookies) => cookies.listSources),
      {
        defaultBundle: null,
      }
    );
    expect(value).toEqual([{ id: 'dia', name: 'Dia', isDefault: false }]);
    const unrun = await runCookies(
      home,
      BrowserCookies.use((cookies) => cookies.listSources),
      { plutilFails: true }
    );
    expect(unrun.value).toEqual([{ id: 'dia', name: 'Dia', isDefault: false }]);
  });

  test('lists the sites a browser is signed in to without asking for its key', async () => {
    const home = createTempDir();
    writeDiaCookies(home, [
      { host: '.github.com', name: 'user_session', value: 's' },
      { host: 'github.com', name: '_gh_sess', value: 's' },
      { host: '.example.com', name: '_ga', value: 'g', httpOnly: false },
    ]);
    const { value, commands } = await runCookies(
      home,
      BrowserCookies.use((cookies) => cookies.listSourceSites('dia'))
    );
    expect(value).toEqual([
      { site: 'github.com', cookies: 2, signedIn: true },
      { site: 'example.com', cookies: 1, signedIn: false },
    ]);
    expect(commands.some((command) => command.argv[0] === 'security')).toBe(false);
  });

  test('reads a browser that is open, whose newest cookies are still in its write-ahead log', async () => {
    const home = createTempDir();
    const open = writeCookieDatabase(
      join(home, 'Library/Application Support/Dia/User Data/Default/Cookies'),
      [{ host: '.github.com', name: 'user_session', value: 's' }],
      { wal: true }
    );
    const { value } = await runCookies(
      home,
      BrowserCookies.use((cookies) => cookies.listSourceSites('dia'))
    );
    open?.close();
    expect(value).toEqual([{ site: 'github.com', cookies: 1, signedIn: true }]);
  });

  test('says when a browser keeps no cookies here, or its database cannot be read', async () => {
    const home = createTempDir();
    const missing = await runCookies(
      home,
      Effect.flip(BrowserCookies.use((cookies) => cookies.listSourceSites('arc')))
    );
    expect(missing.value).toMatchObject({ _tag: 'CookieSourceUnavailable', reason: 'not_installed' });
    const unknown = await runCookies(
      home,
      Effect.flip(BrowserCookies.use((cookies) => cookies.listSourceSites('safari' as SourceBrowserId)))
    );
    expect(unknown.value).toMatchObject({ _tag: 'CookieSourceUnavailable', reason: 'not_installed' });
    mkdirSync(join(home, 'Library/Application Support/Dia/User Data/Default/Cookies'), { recursive: true });
    const broken = await runCookies(
      home,
      Effect.flip(BrowserCookies.use((cookies) => cookies.listSourceSites('dia')))
    );
    expect(broken.value).toMatchObject({ _tag: 'CookieSourceUnavailable', reason: 'unreadable' });
  });

  test('copies only the chosen sites into the project browser, decrypted with the key from the Keychain', async () => {
    const home = createTempDir();
    writeDiaCookies(home, [
      { host: '.github.com', name: 'user_session', value: 'gh-secret' },
      { host: 'github.com', name: 'logged_in', plain: 'yes', httpOnly: false },
      { host: '.github.com', name: 'old', value: 'x', expires: 1000 },
      { host: '.vercel.com', name: 'authorization', value: 'v-secret' },
      { host: '.google.com', name: 'SID', value: 'not chosen' },
    ]);
    const { value, cdp, commands } = await runCookies(
      home,
      BrowserCookies.use((cookies) => cookies.copy(SHINSA, 'dia', ['github.com', 'vercel.com']))
    );
    expect(value.copied).toBe(3);
    expect(value.skipped).toBe(1);
    expect(value.sites.map((site) => site.site).sort()).toEqual(['github.com', 'vercel.com']);
    expect(cdp.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).sort()).toEqual([
      'authorization=v-secret',
      'logged_in=yes',
      'user_session=gh-secret',
    ]);
    expect(commands.find((command) => command.argv[0] === 'security')?.argv).toEqual([
      'security',
      'find-generic-password',
      '-w',
      '-s',
      'Dia Safe Storage',
    ]);
  });

  test('signs the project browser out of one site by expiring its cookies, and leaves the rest', async () => {
    const home = createTempDir();
    writeDiaCookies(home, [
      { host: '.github.com', name: 'user_session', value: 'gh' },
      { host: 'github.com', name: 'logged_in', plain: 'yes', httpOnly: false },
      { host: '.vercel.com', name: 'authorization', value: 'v' },
    ]);
    const { value, cdp } = await runCookies(
      home,
      BrowserCookies.use((cookies) =>
        Effect.andThen(cookies.copy(SHINSA, 'dia', ['github.com', 'vercel.com']), () =>
          cookies.removeSite(SHINSA, 'github.com')
        )
      )
    );
    expect(value.map((site) => site.site)).toEqual(['vercel.com']);
    expect(cdp.cookies.map((cookie) => cookie.name)).toEqual(['authorization']);
    const expiring = cdp.received
      .map((text) => JSON.parse(text) as { method: string; params?: { cookies?: { expires: number }[] } })
      .filter((message) => message.method === 'Storage.setCookies')
      .at(-1);
    expect(expiring?.params?.cookies?.map((cookie) => cookie.expires)).toEqual([1, 1]);
  });

  test('copies nothing when macOS refuses the key, or it comes back empty', async () => {
    const home = createTempDir();
    writeDiaCookies(home, [{ host: '.github.com', name: 'user_session', value: 's' }]);
    for (const keychain of ['refused', 'empty', 'failed'] as const) {
      const { value, cdp } = await runCookies(
        home,
        Effect.flip(BrowserCookies.use((cookies) => cookies.copy(SHINSA, 'dia', ['github.com']))),
        { keychain }
      );
      expect(value).toMatchObject({ _tag: 'KeychainRefused', message: KEYCHAIN_REFUSED_MESSAGE });
      expect(cdp.cookies).toEqual([]);
    }
  });

  test("lists the project browser's sites from Chrome, or from its file when Chrome cannot start", async () => {
    const home = createTempDir();
    const empty = await runCookies(
      home,
      BrowserCookies.use((cookies) => cookies.listSites(SHINSA))
    );
    expect(empty.value).toEqual([]);
    const profile = join(home, 'profiles', SHINSA);
    mkdirSync(profile, { recursive: true });
    const blank = await runCookies(
      home,
      BrowserCookies.use((cookies) => cookies.listSites(SHINSA)),
      {
        unavailable: true,
      }
    );
    expect(blank.value).toEqual([]);
    writeCookieDatabase(join(profile, 'Default/Cookies'), [
      { host: '.vercel.com', name: 'authorization', value: 'v' },
    ]);
    const offline = await runCookies(
      home,
      BrowserCookies.use((cookies) => cookies.listSites(SHINSA)),
      {
        unavailable: true,
      }
    );
    expect(offline.value).toEqual([{ site: 'vercel.com', cookies: 1, signedIn: true }]);
    const broken = join(createTempDir(), 'profiles', SHINSA);
    mkdirSync(join(broken, 'Default/Cookies'), { recursive: true });
    const unreadable = await runCookies(
      join(broken, '../..'),
      BrowserCookies.use((cookies) => cookies.listSites(SHINSA)),
      { unavailable: true }
    );
    expect(unreadable.value).toEqual([]);
    const live = await runCookies(
      home,
      BrowserCookies.use((cookies) => cookies.listSites(SHINSA))
    );
    expect(live.value).toEqual([]);
  });

  test('reads a profile’s saved cookies without starting its Chrome in inspect mode', async () => {
    const home = createTempDir();
    const profile = join(home, 'profiles', SHINSA);
    mkdirSync(profile, { recursive: true });
    writeCookieDatabase(join(profile, 'Default/Cookies'), [
      { host: '.vercel.com', name: 'authorization', value: 'v' },
    ]);
    const inspected = await runCookies(
      home,
      BrowserCookies.use((cookies) => cookies.listSites(SHINSA)),
      { inspect: true }
    );
    expect(inspected.value).toEqual([{ site: 'vercel.com', cookies: 1, signedIn: true }]);
    expect(inspected.acquired).toEqual([]);
  });
});
