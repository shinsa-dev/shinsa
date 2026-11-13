import { describe, expect, it } from 'bun:test';
import {
  resolveChannel,
  resolveChannelKey,
  resolvePointerCacheKey,
  resolveReleaseKey,
} from '../../src/worker/download/paths.ts';
import type { BucketBinding, ByteRange, CacheBinding } from '../../src/worker/platform/schema.ts';
import { type DownloadPointer, KOE, LATEST_STABLE_URL } from '../../src/worker/releases/schema.ts';
import { isUpdatePath, resolveUpdateFile } from '../../src/worker/updates/files.ts';
import { respond, type TestWorld } from './harness.ts';

const DMG_BYTES = new Uint8Array([0x6b, 0x6f, 0x65, 0x00, 0x01, 0x02, 0x03, 0x04]);

const SHA = 'b'.repeat(64);

const UPLOADED = new Date('2026-11-13T14:01:13Z');

const APPCAST =
  '<?xml version="1.0"?><rss version="2.0"><channel><item><title>1.0.0-beta.1</title></item></channel></rss>';

type StoredChannel = 'stable' | 'beta' | 'canary';

interface BucketCall {
  method: 'get' | 'head';
  key: string;
  range?: ByteRange;
}

function pointerOf(version: string): DownloadPointer {
  return {
    version,
    key: resolveReleaseKey(version, KOE),
    size: DMG_BYTES.length,
    sha256: SHA,
    publishedAt: UPLOADED.toISOString(),
  };
}

function storeChannels(channels: [StoredChannel, DownloadPointer][]) {
  const objects: Record<string, string | Uint8Array> = {};
  for (const [channel, pointer] of channels) {
    objects[resolveChannelKey(channel, KOE)] = JSON.stringify(pointer);
    objects[pointer.key] = DMG_BYTES;
  }
  return objects;
}

function createBucket(objects: Record<string, string | Uint8Array>) {
  const calls: BucketCall[] = [];
  const storedBytes = (key: string) => {
    const stored = objects[key];
    if (stored === undefined) return null;
    return typeof stored === 'string' ? new TextEncoder().encode(stored) : stored;
  };
  const bucket: BucketBinding = {
    head: async (key) => {
      calls.push({ method: 'head', key });
      const bytes = storedBytes(key);
      return bytes ? { size: bytes.length, httpEtag: `"etag-${key}"`, uploaded: UPLOADED } : null;
    },
    get: async (key, options) => {
      calls.push({ method: 'get', key, ...(options?.range ? { range: options.range } : {}) });
      const bytes = storedBytes(key);
      if (!bytes) return null;
      const range = options?.range ?? { offset: 0, length: bytes.length };
      const slice = bytes.slice(range.offset, range.offset + range.length);
      return { body: new Response(slice).body, text: async () => new TextDecoder().decode(slice) };
    },
  };
  return { bucket, calls };
}

function createCache() {
  const entries = new Map<string, Response>();
  const cache: CacheBinding = {
    match: async (key) => entries.get(key)?.clone(),
    put: async (key, response) => {
      entries.set(key, response);
    },
  };
  return { cache, entries };
}

function createWorld(bucket: BucketBinding | null, cache: CacheBinding | null = null) {
  const fetched: string[] = [];
  const world: TestWorld = {
    bucket,
    cache,
    fetch: (url) => {
      fetched.push(url);
      return Promise.reject(new Error('network down'));
    },
  };
  return { world, fetched };
}

function createRequest(path: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Request(`https://shinsa.dev${path}`, { method, headers });
}

const RELEASED = storeChannels([
  ['stable', pointerOf('1.0.0')],
  ['beta', pointerOf('1.1.0-beta.2')],
  ['canary', pointerOf('1.1.0-canary.7')],
]);

describe("Koe's download paths", () => {
  it('reads the stable, beta and canary paths under /koe/download, with or without a trailing slash', () => {
    expect(resolveChannel('/koe/download')).toEqual({ product: KOE, channel: 'stable' });
    expect(resolveChannel('/koe/download/')).toEqual({ product: KOE, channel: 'stable' });
    expect(resolveChannel('/koe/download/beta')).toEqual({ product: KOE, channel: 'beta' });
    expect(resolveChannel('/koe/download/canary/')).toEqual({ product: KOE, channel: 'canary' });
  });

  it('leaves the page and every other path under /koe to the static assets', () => {
    for (const path of [
      '/koe',
      '/koe/',
      '/koe/downloads',
      '/koe/download/nightly',
      '/koe/download/version',
    ]) {
      expect(resolveChannel(path)).toBeNull();
    }
  });

  it('keeps every key under koe/ in the bucket and the edge cache', () => {
    expect(resolveReleaseKey('1.0.0-beta.1', KOE)).toBe('koe/releases/1.0.0-beta.1/Koe.dmg');
    expect(resolveChannelKey('stable', KOE)).toBe('koe/channels/stable.json');
    expect(resolvePointerCacheKey('beta', KOE)).toBe(
      'https://shinsa.dev/cache/download/koe/channels/beta.json'
    );
  });
});

describe('respond to a Koe download', () => {
  it('streams the stable disk image, named for Koe and its version, without asking GitHub', async () => {
    const { bucket, calls } = createBucket(RELEASED);
    const { world, fetched } = createWorld(bucket);
    const response = await respond(createRequest('/koe/download'), world);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="Koe-1.0.0.dmg"');
    expect(response.headers.get('Content-Type')).toBe('application/x-apple-diskimage');
    expect(response.headers.get('ETag')).toBe(`"${SHA}"`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(DMG_BYTES);
    expect(calls).toEqual([
      { method: 'get', key: 'koe/channels/stable.json' },
      { method: 'get', key: 'koe/releases/1.0.0/Koe.dmg' },
    ]);
    expect(fetched).toEqual([]);
  });

  it('streams the beta and canary pointers for their paths', async () => {
    const { bucket } = createBucket(RELEASED);
    const beta = await respond(createRequest('/koe/download/beta'), createWorld(bucket).world);
    expect(beta.headers.get('Content-Disposition')).toBe('attachment; filename="Koe-1.1.0-beta.2.dmg"');
    const canary = await respond(createRequest('/koe/download/canary'), createWorld(bucket).world);
    expect(canary.headers.get('Content-Disposition')).toBe('attachment; filename="Koe-1.1.0-canary.7.dmg"');
  });

  it('serves the beta at /koe/download while Koe has no stable release', async () => {
    const { bucket, calls } = createBucket(storeChannels([['beta', pointerOf('1.0.0-beta.1')]]));
    const response = await respond(createRequest('/koe/download'), createWorld(bucket).world);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="Koe-1.0.0-beta.1.dmg"');
    expect(calls.map((call) => call.key)).toEqual([
      'koe/channels/stable.json',
      'koe/channels/beta.json',
      'koe/releases/1.0.0-beta.1/Koe.dmg',
    ]);
  });

  it('reads only the requested range, so a download can resume', async () => {
    const { bucket, calls } = createBucket(RELEASED);
    const response = await respond(
      createRequest('/koe/download', { Range: 'bytes=4-' }),
      createWorld(bucket).world
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 4-7/8');
    expect(calls.at(-1)).toEqual({
      method: 'get',
      key: 'koe/releases/1.0.0/Koe.dmg',
      range: { offset: 4, length: 4 },
    });
  });

  it('remembers the pointer under its own cache key, apart from Shinsa', async () => {
    const { bucket } = createBucket(RELEASED);
    const { cache, entries } = createCache();
    await respond(createRequest('/koe/download/beta'), createWorld(bucket, cache).world);
    expect([...entries.keys()]).toEqual(['https://shinsa.dev/cache/download/koe/channels/beta.json']);
  });

  it('sends every channel to the coming-soon note on the page while Koe has no release, never to GitHub', async () => {
    for (const path of ['/koe/download', '/koe/download/beta', '/koe/download/canary']) {
      const { world, fetched } = createWorld(createBucket({}).bucket);
      const response = await respond(createRequest(path), world);
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/koe#soon');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(fetched).toEqual([]);
    }
  });

  it('never serves a beta for canary', async () => {
    const { bucket } = createBucket(storeChannels([['beta', pointerOf('1.0.0-beta.1')]]));
    const response = await respond(createRequest('/koe/download/canary'), createWorld(bucket).world);
    expect(response.headers.get('Location')).toBe('/koe#soon');
  });

  it('sends a download to the page when the bucket is not bound or its disk image is missing', async () => {
    const unbound = await respond(createRequest('/koe/download'), createWorld(null).world);
    expect(unbound.headers.get('Location')).toBe('/koe#soon');
    const pointerOnly = { [resolveChannelKey('stable', KOE)]: JSON.stringify(pointerOf('1.0.0')) };
    const missing = await respond(
      createRequest('/koe/download'),
      createWorld(createBucket(pointerOnly).bucket).world
    );
    expect(missing.headers.get('Location')).toBe('/koe#soon');
  });

  it("keeps Shinsa's /download apart from Koe's files", async () => {
    const { bucket, calls } = createBucket(RELEASED);
    const response = await respond(createRequest('/download'), createWorld(bucket).world);
    expect(response.headers.get('Location')).toBe(LATEST_STABLE_URL);
    expect(calls.map((call) => call.key)).toEqual(['channels/stable.json', 'channels/beta.json']);
  });
});

describe("Koe's update files", () => {
  it('routes the appcasts and releases under /koe to the update files, and nothing else under /koe', () => {
    expect(isUpdatePath('/koe/appcast/stable.xml')).toBe(true);
    expect(isUpdatePath('/koe/releases/1.0.0/Koe.dmg')).toBe(true);
    expect(isUpdatePath('/koe')).toBe(false);
    expect(isUpdatePath('/koe/download')).toBe(false);
    expect(isUpdatePath('/koe/appcastx')).toBe(false);
  });

  it('serves the three appcasts as XML, short-lived', () => {
    for (const channel of ['stable', 'beta', 'canary']) {
      expect(resolveUpdateFile(`/koe/appcast/${channel}.xml`)).toEqual({
        key: `koe/appcast/${channel}.xml`,
        contentType: 'application/xml; charset=utf-8',
        cacheControl: 'public, max-age=60',
      });
    }
  });

  it('serves the disk image of any version, cached for good', () => {
    expect(resolveUpdateFile('/koe/releases/1.0.0-beta.1/Koe.dmg')).toEqual({
      key: 'koe/releases/1.0.0-beta.1/Koe.dmg',
      contentType: 'application/x-apple-diskimage',
      cacheControl: 'public, max-age=31536000, immutable',
    });
  });

  it('refuses everything else, so no other object in the bucket is reachable', () => {
    for (const path of [
      '/koe/appcast',
      '/koe/appcast/',
      '/koe/appcast/nightly.xml',
      '/koe/appcast/stable.xml/more',
      '/koe/appcast/latest-mac.yml',
      '/koe/releases',
      '/koe/releases/1.0.0',
      '/koe/releases/latest/Koe.dmg',
      '/koe/releases/1.0.0/Shinsa-mac-arm64.dmg',
      '/koe/releases/1.0.0/Koe.dmg/more',
      '/koe/releases/../channels/Koe.dmg',
    ]) {
      expect(resolveUpdateFile(path)).toBeNull();
    }
  });

  it('serves an appcast from koe/appcast/ in the bucket', async () => {
    const { bucket, calls } = createBucket({ 'koe/appcast/beta.xml': APPCAST });
    const response = await respond(createRequest('/koe/appcast/beta.xml'), createWorld(bucket).world);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(await response.text()).toBe(APPCAST);
    expect(calls.map((call) => call.key)).toEqual(['koe/appcast/beta.xml', 'koe/appcast/beta.xml']);
  });

  it("serves a release's disk image, as the appcast's enclosure points there", async () => {
    const { bucket } = createBucket(RELEASED);
    const response = await respond(
      createRequest('/koe/releases/1.1.0-beta.2/Koe.dmg'),
      createWorld(bucket).world
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/x-apple-diskimage');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(DMG_BYTES);
  });

  it('answers 404 for an appcast not written yet, and 405 for anything but GET and HEAD', async () => {
    const { bucket } = createBucket({});
    const missing = await respond(createRequest('/koe/appcast/canary.xml'), createWorld(bucket).world);
    expect(missing.status).toBe(404);
    const posted = await respond(
      createRequest('/koe/appcast/beta.xml', {}, 'POST'),
      createWorld(bucket).world
    );
    expect(posted.status).toBe(405);
  });
});
