import { describe, expect, it } from 'bun:test';
import {
  compareVersions,
  type DownloadCache,
  type DownloadWorld,
  NO_STABLE_PAGE,
  parseVersion,
  RELEASES_API,
  RELEASES_CACHE_KEY,
  resolveCachedReleases,
  resolveChannel,
  resolveReleases,
  respond,
  UNAVAILABLE_PAGE,
  type Version,
} from '../../src/worker/download.ts';

const DMG_BYTES = new Uint8Array([0x6b, 0x6f, 0x6c, 0x79, 0x00, 0x01, 0x02, 0x03]);

function asset(tag: string, name = 'Shinsa-mac-arm64.dmg') {
  return {
    name,
    size: DMG_BYTES.length,
    browser_download_url: `https://github.com/shinsa-dev/shinsa/releases/download/${tag}/${name}`,
  };
}

function dmgOf(tag: string) {
  return asset(tag).browser_download_url;
}

function release(tag: string, overrides: Record<string, unknown> = {}) {
  return { tag_name: tag, draft: false, prerelease: tag.includes('-'), assets: [asset(tag)], ...overrides };
}

function picked(tag: string) {
  return { version: tag.replace(/^v/, ''), url: dmgOf(tag), size: DMG_BYTES.length };
}

function version(tag: string): Version {
  const parsed = parseVersion(tag);
  if (!parsed) throw new Error(`Not a version: ${tag}`);
  return parsed;
}

function createCache() {
  const entries = new Map<string, Response>();
  const cache: DownloadCache = {
    match: async (key) => entries.get(key)?.clone(),
    put: async (key, response) => {
      entries.set(key, response);
    },
  };
  return { cache, entries };
}

type Answer = (url: string, init: RequestInit) => Promise<Response>;

function createWorld(answer: Answer, cache: DownloadCache | null = null) {
  const calls: { url: string; init: RequestInit }[] = [];
  const pages: { url: string; method: string }[] = [];
  const world: DownloadWorld = {
    fetch: (url, init) => {
      calls.push({ url, init });
      return answer(url, init);
    },
    cache,
    assets: async (request) => {
      pages.push({ url: request.url, method: request.method });
      const body = request.method === 'HEAD' ? null : `page ${new URL(request.url).pathname}`;
      return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    },
  };
  return { world, calls, pages };
}

function answerWith(body: unknown, status = 200) {
  return () => Promise.resolve(Response.json(body, { status }));
}

const DMG_HEADERS = { ETag: '"dmg"', 'Last-Modified': 'Tue, 27 Oct 2026 12:00:00 GMT' };

function serveDmg(_url: string, init: RequestInit) {
  const range = new Headers(init.headers).get('range');
  if (!range) {
    return Promise.resolve(
      new Response(DMG_BYTES, { headers: { ...DMG_HEADERS, 'Content-Length': String(DMG_BYTES.length) } })
    );
  }
  const start = Number(/^bytes=(\d+)-$/.exec(range)?.[1]);
  if (start >= DMG_BYTES.length) {
    return Promise.resolve(
      new Response('out of range', {
        status: 416,
        headers: { 'Content-Range': `bytes */${DMG_BYTES.length}` },
      })
    );
  }
  const slice = DMG_BYTES.slice(start);
  return Promise.resolve(
    new Response(slice, {
      status: 206,
      headers: {
        ...DMG_HEADERS,
        'Content-Length': String(slice.length),
        'Content-Range': `bytes ${start}-${DMG_BYTES.length - 1}/${DMG_BYTES.length}`,
      },
    })
  );
}

function createGitHub(releases: unknown, assetAnswer: Answer = serveDmg) {
  return createWorld((url, init) =>
    url === RELEASES_API ? Promise.resolve(Response.json(releases)) : assetAnswer(url, init)
  );
}

function createRequest(path: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Request(`https://shinsa.dev${path}`, { method, headers });
}

describe('resolveChannel', () => {
  it('reads the stable and beta download paths, with or without a trailing slash', () => {
    expect(resolveChannel('/download')).toBe('stable');
    expect(resolveChannel('/download/')).toBe('stable');
    expect(resolveChannel('/download/beta')).toBe('beta');
    expect(resolveChannel('/download/beta/')).toBe('beta');
  });

  it('leaves every other path to the static assets', () => {
    expect(resolveChannel('/')).toBeNull();
    expect(resolveChannel('/download/nightly')).toBeNull();
    expect(resolveChannel('/downloads')).toBeNull();
  });
});

describe('parseVersion', () => {
  it('reads a release tag and a pre-release tag', () => {
    expect(parseVersion('v1.3.0')).toEqual({ core: [1, 3, 0], prerelease: [] });
    expect(parseVersion('1.3.0-beta.2')).toEqual({ core: [1, 3, 0], prerelease: ['beta', 2] });
    expect(parseVersion('v2.0.0-rc.1+build.5')).toEqual({ core: [2, 0, 0], prerelease: ['rc', 1] });
  });

  it('refuses a tag that is not a version', () => {
    expect(parseVersion('latest')).toBeNull();
    expect(parseVersion('v1.3')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders by semver, a pre-release before its release', () => {
    const ordered = [
      '1.2.9',
      '1.3.0-alpha',
      '1.3.0-alpha.1',
      '1.3.0-alpha.beta',
      '1.3.0-beta',
      '1.3.0-beta.2',
      '1.3.0-beta.11',
      '1.3.0-rc.1',
      '1.3.0',
      '1.10.0',
      '2.0.0',
    ];
    for (const [index, tag] of ordered.entries()) {
      for (const [other, next] of ordered.entries()) {
        expect(Math.sign(compareVersions(version(tag), version(next)))).toBe(Math.sign(index - other));
      }
    }
  });
});

describe('resolveReleases', () => {
  it('takes the newest release by version, not by list order, for each channel', () => {
    const releases = [
      release('v1.2.9'),
      release('v1.3.0-beta.2'),
      release('v1.3.0-beta.11'),
      release('v1.2.0'),
    ];
    expect(resolveReleases(releases)).toEqual({ stable: picked('v1.2.9'), beta: picked('v1.3.0-beta.11') });
  });

  it('gives beta a stable release over its own betas', () => {
    expect(resolveReleases([release('v1.3.0-beta.2'), release('v1.3.0')])?.beta).toEqual(picked('v1.3.0'));
  });

  it('keeps a release GitHub marks as a pre-release, or does not mark at all, out of stable', () => {
    const releases = [release('v1.4.0', { prerelease: true }), release('v1.5.0', { prerelease: undefined })];
    expect(resolveReleases(releases)).toEqual({ stable: null, beta: picked('v1.5.0') });
  });

  it('skips drafts, tags that are not versions and releases without the disk image', () => {
    const releases = [
      release('v1.4.0', { draft: true }),
      release('nightly'),
      release('v1.3.1', { assets: [asset('v1.3.1', 'Shinsa-mac-arm64.zip')] }),
      release('v1.3.2', { assets: [{ name: 'Shinsa-mac-arm64.dmg', size: 8 }] }),
      release('v1.3.5', { assets: [{ ...asset('v1.3.5'), size: '8' }] }),
      release('v1.3.3', { assets: null }),
      null,
      'v1.9.0',
      { ...release('v1.3.4'), tag_name: 7 },
      release('v1.3.0-beta.2', { assets: [7, asset('v1.3.0-beta.2')] }),
    ];
    expect(resolveReleases(releases)).toEqual({ stable: null, beta: picked('v1.3.0-beta.2') });
  });

  it('is null when the answer is not a list', () => {
    expect(resolveReleases({ message: 'API rate limit exceeded' })).toBeNull();
  });
});

describe('resolveCachedReleases', () => {
  it('asks GitHub for the releases as an identified client and keeps the answer five minutes', async () => {
    const { cache, entries } = createCache();
    const { world, calls } = createWorld(answerWith([release('v1.0.0-beta.1')]), cache);
    const expected = { stable: null, beta: picked('v1.0.0-beta.1') };
    expect(await resolveCachedReleases(world)).toEqual(expected);
    expect(calls.map((call) => call.url)).toEqual([RELEASES_API]);
    expect(calls[0]?.init.headers).toMatchObject({
      Accept: 'application/vnd.github+json',
      'User-Agent': 'shinsa.dev',
    });
    expect(entries.get(RELEASES_CACHE_KEY)?.headers.get('Cache-Control')).toBe('max-age=300');
    expect(await resolveCachedReleases(world)).toEqual(expected);
    expect(calls).toHaveLength(1);
  });

  it('works without a cache', async () => {
    const { world } = createWorld(answerWith([release('v1.3.0')]));
    expect(await resolveCachedReleases(world)).toEqual({ stable: picked('v1.3.0'), beta: picked('v1.3.0') });
  });

  it('is null on a rate limit, a network error or an answer that is not a list, and keeps nothing', async () => {
    const { cache, entries } = createCache();
    const limited = createWorld(answerWith({ message: 'API rate limit exceeded' }, 403), cache).world;
    const offline = createWorld(() => Promise.reject(new Error('network down')), cache).world;
    const garbled = createWorld(() => Promise.resolve(new Response('not json')), cache).world;
    const listless = createWorld(answerWith({ message: 'Not Found' }), cache).world;
    for (const world of [limited, offline, garbled, listless]) {
      expect(await resolveCachedReleases(world)).toBeNull();
    }
    expect(entries.size).toBe(0);
  });
});

describe('respond', () => {
  const releases = [release('v1.3.0-beta.2'), release('v1.2.9')];

  it('streams the stable disk image from shinsa.dev, named for its version, without a redirect', async () => {
    const { world, calls } = createGitHub(releases);
    const response = await respond(createRequest('/download'), world);
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toEqual({
      'accept-ranges': 'bytes',
      'cache-control': 'public, max-age=300',
      'content-disposition': 'attachment; filename="Shinsa-1.2.9.dmg"',
      'content-length': String(DMG_BYTES.length),
      'content-type': 'application/x-apple-diskimage',
      etag: '"dmg"',
      'last-modified': 'Tue, 27 Oct 2026 12:00:00 GMT',
      'x-content-type-options': 'nosniff',
    });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(DMG_BYTES);
    expect(calls.map((call) => call.url)).toEqual([RELEASES_API, dmgOf('v1.2.9')]);
    expect(calls[1]?.init.redirect).toBe('follow');
    expect(new Headers(calls[1]?.init.headers).get('User-Agent')).toBe('shinsa.dev');
  });

  it('streams the newest release, pre-releases included, for beta', async () => {
    const { world, calls } = createGitHub(releases);
    const response = await respond(createRequest('/download/beta/'), world);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="Shinsa-1.3.0-beta.2.dmg"'
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(DMG_BYTES);
    expect(calls[1]?.url).toBe(dmgOf('v1.3.0-beta.2'));
  });

  it('answers HEAD from the release list without fetching the disk image', async () => {
    const { world, calls } = createGitHub(releases);
    const response = await respond(createRequest('/download/beta', {}, 'HEAD'), world);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBe(String(DMG_BYTES.length));
    expect(response.headers.get('Content-Type')).toBe('application/x-apple-diskimage');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.body).toBeNull();
    expect(calls.map((call) => call.url)).toEqual([RELEASES_API]);
  });

  it('passes a range through so a download can resume', async () => {
    const { world, calls } = createGitHub(releases);
    const response = await respond(
      createRequest('/download', { Range: 'bytes=4-', 'If-Range': '"dmg"' }),
      world
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe(`bytes 4-7/${DMG_BYTES.length}`);
    expect(response.headers.get('Content-Length')).toBe('4');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(DMG_BYTES.slice(4));
    const forwarded = new Headers(calls[1]?.init.headers);
    expect(forwarded.get('Range')).toBe('bytes=4-');
    expect(forwarded.get('If-Range')).toBe('"dmg"');
  });

  it('passes an unsatisfiable range through without a body', async () => {
    const { world } = createGitHub(releases);
    const response = await respond(createRequest('/download', { Range: 'bytes=100-' }), world);
    expect(response.status).toBe(416);
    expect(response.headers.get('Content-Range')).toBe(`bytes */${DMG_BYTES.length}`);
    expect(await response.text()).toBe('');
  });

  it('shows the no stable release page, with the beta on offer, when only betas exist', async () => {
    const { world, pages } = createGitHub([release('v1.0.0-beta.1')]);
    const response = await respond(createRequest('/download'), world);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe(`page ${NO_STABLE_PAGE}`);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Retry-After')).toBeNull();
    expect(pages).toEqual([{ url: `https://shinsa.dev${NO_STABLE_PAGE}`, method: 'GET' }]);
  });

  it('shows the unavailable page as a 404 when no release has the disk image', async () => {
    const { world } = createGitHub([release('v1.3.0', { assets: [] })]);
    for (const path of ['/download', '/download/beta']) {
      const response = await respond(createRequest(path), world);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe(`page ${UNAVAILABLE_PAGE}`);
    }
  });

  it('shows the unavailable page as a 503 to retry when GitHub does not answer', async () => {
    const { world } = createWorld(answerWith({ message: 'API rate limit exceeded' }, 403));
    const response = await respond(createRequest('/download/beta'), world);
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('300');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe(`page ${UNAVAILABLE_PAGE}`);
  });

  it('shows the unavailable page when the disk image is missing upstream or its fetch fails', async () => {
    const cancelled: number[] = [];
    const missingBody = new ReadableStream({
      cancel: () => {
        cancelled.push(404);
      },
    });
    const missing = createGitHub(releases, () =>
      Promise.resolve(new Response(missingBody, { status: 404 }))
    ).world;
    const offline = createGitHub(releases, () => Promise.reject(new Error('connection reset'))).world;
    for (const world of [missing, offline]) {
      const response = await respond(createRequest('/download'), world);
      expect(response.status).toBe(503);
      expect(await response.text()).toBe(`page ${UNAVAILABLE_PAGE}`);
    }
    expect(cancelled).toEqual([404]);
  });

  it('answers HEAD for a fallback page without a body', async () => {
    const { world, pages } = createGitHub([]);
    const response = await respond(createRequest('/download', {}, 'HEAD'), world);
    expect(response.status).toBe(404);
    expect(response.body).toBeNull();
    expect(pages[0]?.method).toBe('HEAD');
  });

  it('serves every other path from the static assets', async () => {
    const { world, calls } = createGitHub(releases);
    expect(await (await respond(createRequest('/download/other'), world)).text()).toBe(
      'page /download/other'
    );
    expect(calls).toEqual([]);
  });
});
