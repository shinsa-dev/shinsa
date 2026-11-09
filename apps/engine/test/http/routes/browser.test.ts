import { afterEach, describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { CdpFailed } from '../../../src/browser/cdp/schema.ts';
import { CookieSourceUnavailable, KeychainRefused } from '../../../src/browser/cookies/schema.ts';
import type { BrowserCookies } from '../../../src/browser/cookies/service.ts';
import {
  BrowserUnavailable,
  type BrowserMode,
  type BrowserProfile,
} from '../../../src/browser/host/schema.ts';
import type { BrowserHost } from '../../../src/browser/host/service.ts';
import { disposeWebHandlers } from '../../helpers/web.ts';
import { readFailure, startRoutes } from './harness.ts';

afterEach(disposeWebHandlers);

interface Calls {
  windows: [string, string | null][];
  closed: string[];
  removed: string[];
  copied: [string, string, readonly string[]][];
}

type Failure = 'unavailable' | 'source' | 'keychain' | 'cdp' | null;

async function setup(failure: Failure = null) {
  const calls: Calls = { windows: [], closed: [], removed: [], copied: [] };
  let mode: BrowserMode = 'stopped';
  const host: BrowserHost['Service'] = {
    acquire: () => Effect.succeed({ webSocketUrl: 'ws://127.0.0.1:1/' }),
    openWindow: (profile, url) =>
      failure === 'unavailable'
        ? Effect.fail(new BrowserUnavailable({ reason: 'not_installed', message: 'Install Chrome.' }))
        : Effect.sync(() => {
            calls.windows.push([profile, url]);
            mode = 'window';
          }),
    closeWindow: (profile) =>
      Effect.sync(() => {
        calls.closed.push(profile);
        mode = 'stopped';
      }),
    stop: () => Effect.void,
    remove: (profile) => Effect.sync(() => calls.removed.push(profile)),
    resolveMode: () => Effect.sync(() => mode),
    resolveProfilePath: (profile) => profile,
  };
  const sites = [{ site: 'github.com', cookies: 3, signedIn: true }];
  const copyFailure = {
    source: new CookieSourceUnavailable({ reason: 'not_installed', message: 'No cookies here.' }),
    keychain: new KeychainRefused({ message: 'macOS said no.' }),
    cdp: new CdpFailed({ method: 'Storage.setCookies', reason: 'closed', message: 'Gone.' }),
    unavailable: new BrowserUnavailable({ reason: 'signing_in', message: 'Signing in.' }),
  };
  const cookies: BrowserCookies['Service'] = {
    listSources: Effect.succeed([{ id: 'dia', name: 'Dia', isDefault: true }]),
    listSourceSites: () => (failure === 'source' ? Effect.fail(copyFailure.source) : Effect.succeed(sites)),
    copy: (profile: BrowserProfile, source, chosen) =>
      failure
        ? Effect.fail(copyFailure[failure])
        : Effect.sync(() => {
            calls.copied.push([profile, source, chosen]);
            return { copied: 3, skipped: 0, sites };
          }),
    listSites: () => Effect.succeed(mode === 'stopped' && calls.removed.length > 0 ? [] : sites),
  };
  const routes = startRoutes({ browserHost: host, browserCookies: cookies });
  const { engine } = routes.context;
  await engine.dispatch({ type: 'project.write', project: { name: 'Basket', color: 'blue' } });
  const projectId = Object.keys(engine.state.projects)[0] ?? '';
  const call = async (method: 'GET' | 'POST', path: string, body: unknown = {}) => {
    const response = await (method === 'GET' ? routes.send(path) : routes.post(path, body));
    if (!response.ok) throw Object.assign(new Error('failed'), await readFailure(response));
    return (await response.json()) as Record<string, unknown>;
  };
  return { call, calls, projectId };
}

describe("a project's shared browser over HTTP", () => {
  test("shows the project browser's mode and the sites it is signed in to", async () => {
    const { call, projectId } = await setup();
    expect(await call('GET', `/api/browser/projects/${projectId}`)).toEqual({
      mode: 'stopped',
      sites: [{ site: 'github.com', cookies: 3, signedIn: true }],
    });
  });

  test('lists the browsers to copy from and the sites each is signed in to', async () => {
    const { call } = await setup();
    expect(await call('GET', '/api/browser/sources')).toEqual({
      sources: [{ id: 'dia', name: 'Dia', isDefault: true }],
    });
    expect(await call('GET', '/api/browser/sources/dia/sites')).toMatchObject({
      sites: [{ site: 'github.com' }],
    });
    await expect(call('GET', '/api/browser/sources/safari/sites')).rejects.toMatchObject({
      code: 'browser_source_invalid',
    });
  });

  test('copies the chosen sites into the project browser', async () => {
    const { call, calls, projectId } = await setup();
    const answer = await call('POST', `/api/browser/projects/${projectId}/copy`, {
      source: 'dia',
      sites: ['github.com'],
    });
    expect(answer).toMatchObject({ copied: 3, skipped: 0 });
    expect(calls.copied).toEqual([[projectId, 'dia', ['github.com']]]);
  });

  test('refuses a copy with no sites, too many, or an unknown project', async () => {
    const { call, projectId } = await setup();
    for (const sites of [
      [],
      'github.com',
      [''],
      Array.from({ length: 501 }, (_, index) => `s${index}.com`),
    ]) {
      await expect(
        call('POST', `/api/browser/projects/${projectId}/copy`, { source: 'dia', sites })
      ).rejects.toMatchObject({ code: 'browser_sites_invalid' });
    }
    await expect(
      call('POST', '/api/browser/projects/nope/copy', { source: 'dia', sites: ['github.com'] })
    ).rejects.toMatchObject({ code: 'project_not_found' });
  });

  test('says why a copy failed', async () => {
    const expected: Record<Exclude<Failure, null>, string> = {
      source: 'browser_source_not_installed',
      keychain: 'keychain_refused',
      cdp: 'browser_failed',
      unavailable: 'browser_signing_in',
    };
    for (const [failure, code] of Object.entries(expected)) {
      const { call, projectId } = await setup(failure as Failure);
      await expect(
        call('POST', `/api/browser/projects/${projectId}/copy`, { source: 'dia', sites: ['github.com'] })
      ).rejects.toMatchObject({ code });
    }
  });

  test('opens the sign-in window, on a page or blank, and closes it again', async () => {
    const { call, calls, projectId } = await setup();
    expect(
      await call('POST', `/api/browser/projects/${projectId}/window`, { url: 'https://accounts.google.com/' })
    ).toMatchObject({ mode: 'window' });
    await call('POST', `/api/browser/projects/${projectId}/window`, {});
    expect(calls.windows).toEqual([
      [projectId, 'https://accounts.google.com/'],
      [projectId, null],
    ]);
    await expect(
      call('POST', `/api/browser/projects/${projectId}/window`, { url: 'javascript:alert(1)' })
    ).rejects.toMatchObject({ code: 'browser_url_invalid' });
    expect(await call('POST', `/api/browser/projects/${projectId}/window/close`)).toMatchObject({
      mode: 'stopped',
    });
    expect(calls.closed).toEqual([projectId]);
  });

  test('says when there is no Chrome to sign in with', async () => {
    const { call, projectId } = await setup('unavailable');
    await expect(call('POST', `/api/browser/projects/${projectId}/window`, {})).rejects.toMatchObject({
      code: 'browser_not_installed',
    });
  });

  test('signs out of everything by removing the profile', async () => {
    const { call, calls, projectId } = await setup();
    expect(await call('POST', `/api/browser/projects/${projectId}/sign-out`)).toEqual({
      mode: 'stopped',
      sites: [],
    });
    expect(calls.removed).toEqual([projectId]);
  });

  test('is not there when the engine runs without a shared browser', async () => {
    const routes = startRoutes();
    const response = await routes.send('/api/browser/sources');
    expect(response.status).toBe(404);
  });
});
