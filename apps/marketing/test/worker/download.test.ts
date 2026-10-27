import { describe, expect, it } from 'bun:test';
import {
  BETA_CACHE_KEY,
  compareVersions,
  type DownloadCache,
  type DownloadWorld,
  parseVersion,
  RELEASES_API,
  RELEASES_URL,
  resolveBetaUrl,
  resolveChannel,
  resolveDownloadUrl,
  respond,
  STABLE_URL,
  type Version,
} from '../../src/worker/download.ts';

function asset(tag: string, name = 'Shinsa-mac-arm64.dmg') {
  return {
    name,
    browser_download_url: `https://github.com/shinsa-dev/shinsa/releases/download/${tag}/${name}`,
  };
}

function release(tag: string, overrides: Record<string, unknown> = {}) {
  return { tag_name: tag, draft: false, prerelease: tag.includes('-'), assets: [asset(tag)], ...overrides };
}

function dmgOf(tag: string) {
  return asset(tag).browser_download_url;
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

function createWorld(answer: () => Promise<Response>, cache: DownloadCache | null = null) {
  const calls: { url: string; init: RequestInit }[] = [];
  const world: DownloadWorld = {
    fetch: (url, init) => {
      calls.push({ url, init });
      return answer();
    },
    cache,
    assets: async (request) => new Response(`asset ${new URL(request.url).pathname}`),
  };
  return { world, calls };
}

function answerWith(body: unknown, status = 200) {
  return () => Promise.resolve(Response.json(body, { status }));
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

describe('resolveBetaUrl', () => {
  it('takes the newest release by version, not by list order, pre-releases included', () => {
    const releases = [
      release('v1.2.9'),
      release('v1.3.0-beta.2'),
      release('v1.3.0-beta.11'),
      release('v1.2.0'),
    ];
    expect(resolveBetaUrl(releases)).toBe(dmgOf('v1.3.0-beta.11'));
  });

  it('takes a stable release over its own betas', () => {
    expect(resolveBetaUrl([release('v1.3.0-beta.2'), release('v1.3.0')])).toBe(dmgOf('v1.3.0'));
  });

  it('skips drafts, tags that are not versions and releases without the disk image', () => {
    const releases = [
      release('v1.4.0', { draft: true }),
      release('nightly'),
      release('v1.3.1', { assets: [asset('v1.3.1', 'Shinsa-mac-arm64.zip')] }),
      release('v1.3.2', { assets: [{ name: 'Shinsa-mac-arm64.dmg' }] }),
      release('v1.3.3', { assets: null }),
      null,
      'v1.9.0',
      { ...release('v1.3.4'), tag_name: 7 },
      release('v1.3.0-beta.2', { assets: [7, asset('v1.3.0-beta.2')] }),
    ];
    expect(resolveBetaUrl(releases)).toBe(dmgOf('v1.3.0-beta.2'));
  });

  it('is null when nothing has the disk image or the answer is not a list', () => {
    expect(resolveBetaUrl([release('v1.3.0', { assets: [] })])).toBeNull();
    expect(resolveBetaUrl({ message: 'API rate limit exceeded' })).toBeNull();
  });
});

describe('resolveDownloadUrl', () => {
  it('sends stable to the latest release without asking GitHub', async () => {
    const { world, calls } = createWorld(answerWith([]));
    expect(await resolveDownloadUrl('stable', world)).toBe(STABLE_URL);
    expect(calls).toEqual([]);
  });

  it('asks GitHub for the releases as an identified client and keeps the answer five minutes', async () => {
    const { cache, entries } = createCache();
    const { world, calls } = createWorld(answerWith([release('v1.3.0-beta.2')]), cache);
    expect(await resolveDownloadUrl('beta', world)).toBe(dmgOf('v1.3.0-beta.2'));
    expect(calls.map((call) => call.url)).toEqual([RELEASES_API]);
    expect(calls[0]?.init.headers).toMatchObject({
      Accept: 'application/vnd.github+json',
      'User-Agent': 'shinsa.dev',
    });
    expect(entries.get(BETA_CACHE_KEY)?.headers.get('Cache-Control')).toBe('max-age=300');
    expect(await resolveDownloadUrl('beta', world)).toBe(dmgOf('v1.3.0-beta.2'));
    expect(calls).toHaveLength(1);
  });

  it('works without a cache', async () => {
    const { world } = createWorld(answerWith([release('v1.3.0-beta.2')]));
    expect(await resolveDownloadUrl('beta', world)).toBe(dmgOf('v1.3.0-beta.2'));
  });

  it('falls back to the releases page on a rate limit, a network error or no disk image, and keeps no answer', async () => {
    const { cache, entries } = createCache();
    const limited = createWorld(answerWith({ message: 'API rate limit exceeded' }, 403), cache).world;
    const offline = createWorld(() => Promise.reject(new Error('network down')), cache).world;
    const empty = createWorld(answerWith([release('v1.3.0', { assets: [] })]), cache).world;
    const garbled = createWorld(() => Promise.resolve(new Response('not json')), cache).world;
    for (const world of [limited, offline, empty, garbled]) {
      expect(await resolveDownloadUrl('beta', world)).toBe(RELEASES_URL);
    }
    expect(entries.size).toBe(0);
  });
});

describe('respond', () => {
  it('redirects both download paths and serves everything else from the assets', async () => {
    const { world } = createWorld(answerWith([release('v1.3.0-beta.2'), release('v1.2.9')]));
    const stable = await respond(new Request('https://shinsa.dev/download'), world);
    expect(stable.status).toBe(302);
    expect(stable.headers.get('Location')).toBe(STABLE_URL);
    const beta = await respond(new Request('https://shinsa.dev/download/beta'), world);
    expect(beta.status).toBe(302);
    expect(beta.headers.get('Location')).toBe(dmgOf('v1.3.0-beta.2'));
    expect(await (await respond(new Request('https://shinsa.dev/download/other'), world)).text()).toBe(
      'asset /download/other'
    );
  });
});
