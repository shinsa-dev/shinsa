import { describe, expect, it } from 'bun:test';
import {
  type ByteRange,
  type DownloadBucket,
  type DownloadCache,
  type DownloadPointer,
  type DownloadWorld,
  FEED_CACHE_KEY,
  LATEST_STABLE_URL,
  listFeedVersions,
  parseDownloadPointer,
  parseRange,
  RELEASES_FEED,
  RELEASES_PAGE,
  resolveChannel,
  resolveChannelKey,
  resolvePointerCacheKey,
  resolveReleaseKey,
  respond,
} from '../../src/worker/download.ts';

const DMG_BYTES = new Uint8Array([0x6b, 0x6f, 0x6c, 0x79, 0x00, 0x01, 0x02, 0x03]);

const SHA = 'a'.repeat(64);

const PUBLISHED_AT = '2026-10-27T12:11:13Z';

const LAST_MODIFIED = 'Tue, 27 Oct 2026 12:11:13 GMT';

const EARLIER = 'Mon, 26 Oct 2026 12:00:00 GMT';

type StoredChannel = 'stable' | 'beta';

function pointerOf(version: string, overrides: Partial<DownloadPointer> = {}): DownloadPointer {
  return {
    version,
    key: resolveReleaseKey(version),
    size: DMG_BYTES.length,
    sha256: SHA,
    publishedAt: PUBLISHED_AT,
    ...overrides,
  };
}

interface BucketCall {
  method: 'get' | 'head';
  key: string;
  range?: ByteRange;
}

function createBucket(objects: Record<string, string | Uint8Array>, failure?: Error) {
  const calls: BucketCall[] = [];
  const bucket: DownloadBucket = {
    head: async (key) => {
      calls.push({ method: 'head', key });
      return key in objects ? {} : null;
    },
    get: async (key, options) => {
      calls.push({ method: 'get', key, ...(options?.range ? { range: options.range } : {}) });
      if (failure) throw failure;
      const stored = objects[key];
      if (stored === undefined) return null;
      const bytes = typeof stored === 'string' ? new TextEncoder().encode(stored) : stored;
      const range = options?.range ?? { offset: 0, length: bytes.length };
      const slice = bytes.slice(range.offset, range.offset + range.length);
      return { body: new Response(slice).body, text: async () => new TextDecoder().decode(slice) };
    },
  };
  return { bucket, calls };
}

function storeChannels(channels: [StoredChannel, DownloadPointer | string][]) {
  const objects: Record<string, string | Uint8Array> = {};
  for (const [channel, pointer] of channels) {
    objects[resolveChannelKey(channel)] = typeof pointer === 'string' ? pointer : JSON.stringify(pointer);
    if (typeof pointer !== 'string') objects[pointer.key] = DMG_BYTES;
  }
  return objects;
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

type Answer = (url: string) => Promise<Response>;

type Conditions = Record<string, string>[];

function feedOf(tags: string[]) {
  const entries = tags.map(
    (tag) =>
      `<entry><id>tag:github.com,2008:Repository/1/${tag}</id><link rel="alternate" type="text/html" href="https://github.com/shinsa-dev/shinsa/releases/tag/${tag}"/></entry>`
  );
  return `<?xml version="1.0" encoding="UTF-8"?><feed><link type="text/html" rel="alternate" href="https://github.com/shinsa-dev/shinsa/releases"/>${entries.join('')}</feed>`;
}

function answerFeed(tags: string[]): Answer {
  return () =>
    Promise.resolve(new Response(feedOf(tags), { headers: { 'Content-Type': 'application/atom+xml' } }));
}

const unreachable: Answer = () => Promise.reject(new Error('network down'));

function createWorld({
  bucket = null,
  answer = unreachable,
  cache = null,
}: {
  bucket?: DownloadBucket | null;
  answer?: Answer;
  cache?: DownloadCache | null;
}) {
  const fetched: { url: string; init: RequestInit }[] = [];
  const pages: string[] = [];
  const world: DownloadWorld = {
    bucket,
    fetch: (url, init) => {
      fetched.push({ url, init });
      return answer(url);
    },
    cache,
    assets: async (request) => {
      pages.push(new URL(request.url).pathname);
      return new Response(`page ${new URL(request.url).pathname}`);
    },
  };
  return { world, fetched, pages };
}

function createRequest(path: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Request(`https://shinsa.dev${path}`, { method, headers });
}

const RELEASED = storeChannels([
  ['stable', pointerOf('1.2.9')],
  ['beta', pointerOf('1.3.0-beta.2')],
]);

function dmgUrl(tag: string) {
  return `https://github.com/shinsa-dev/shinsa/releases/download/${tag}/Shinsa-mac-arm64.dmg`;
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

describe('the bucket layout', () => {
  it('keeps one disk image per version and one pointer per channel', () => {
    expect(resolveReleaseKey('1.0.0-beta.1')).toBe('releases/1.0.0-beta.1/Shinsa-mac-arm64.dmg');
    expect(resolveChannelKey('stable')).toBe('channels/stable.json');
    expect(resolvePointerCacheKey('beta')).toBe('https://shinsa.dev/cache/download/channels/beta.json');
  });
});

describe('parseDownloadPointer', () => {
  it('reads a pointer the release workflow wrote', () => {
    expect(parseDownloadPointer(pointerOf('1.0.0-beta.1'))).toEqual(pointerOf('1.0.0-beta.1'));
  });

  it('refuses anything else', () => {
    for (const value of [
      null,
      'pointer',
      pointerOf('latest'),
      { ...pointerOf('1.0.0'), version: 7 },
      pointerOf('1.0.0', { key: '' }),
      { ...pointerOf('1.0.0'), key: 7 },
      { ...pointerOf('1.0.0'), size: '8' },
      pointerOf('1.0.0', { size: -1 }),
      pointerOf('1.0.0', { size: 1.5 }),
      pointerOf('1.0.0', { sha256: 'ABC' }),
      { ...pointerOf('1.0.0'), sha256: null },
      pointerOf('1.0.0', { publishedAt: 'yesterday' }),
      { ...pointerOf('1.0.0'), publishedAt: 0 },
    ]) {
      expect(parseDownloadPointer(value)).toBeNull();
    }
  });
});

describe('parseRange', () => {
  it('reads a single byte range against the file size', () => {
    expect(parseRange('bytes=4-', 8)).toEqual({ offset: 4, length: 4 });
    expect(parseRange('bytes=2-5', 8)).toEqual({ offset: 2, length: 4 });
    expect(parseRange('bytes=2-100', 8)).toEqual({ offset: 2, length: 6 });
    expect(parseRange('bytes=-3', 8)).toEqual({ offset: 5, length: 3 });
    expect(parseRange('bytes=-100', 8)).toEqual({ offset: 0, length: 8 });
  });

  it('cannot satisfy a range past the end, an empty suffix or any range of an empty file', () => {
    expect(parseRange('bytes=8-', 8)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 8)).toBe('unsatisfiable');
    expect(parseRange('bytes=-4', 0)).toBe('unsatisfiable');
  });

  it('ignores a range it does not take, so the whole file is sent', () => {
    expect(parseRange('bytes=0-1,4-5', 8)).toBeNull();
    expect(parseRange('items=0-1', 8)).toBeNull();
    expect(parseRange('bytes=-', 8)).toBeNull();
    expect(parseRange('bytes=5-2', 8)).toBeNull();
  });
});

describe('listFeedVersions', () => {
  it('lists the release tags of the feed that are versions, in the feed order', () => {
    expect(listFeedVersions(feedOf(['v1.3.0-beta.2', 'nightly', 'v1.2.9']))).toEqual([
      'v1.3.0-beta.2',
      'v1.2.9',
    ]);
    expect(listFeedVersions('not a feed')).toEqual([]);
  });
});

describe('respond from the bucket', () => {
  it('streams the stable disk image from shinsa.dev, named for its version, without a redirect', async () => {
    const { bucket, calls } = createBucket(RELEASED);
    const { world, fetched } = createWorld({ bucket });
    const response = await respond(createRequest('/download'), world);
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toEqual({
      'accept-ranges': 'bytes',
      'cache-control': 'public, max-age=300',
      'content-disposition': 'attachment; filename="Shinsa-1.2.9.dmg"',
      'content-length': String(DMG_BYTES.length),
      'content-type': 'application/x-apple-diskimage',
      etag: `"${SHA}"`,
      'last-modified': LAST_MODIFIED,
      'x-content-type-options': 'nosniff',
    });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(DMG_BYTES);
    expect(calls).toEqual([
      { method: 'get', key: 'channels/stable.json' },
      { method: 'get', key: 'releases/1.2.9/Shinsa-mac-arm64.dmg' },
    ]);
    expect(fetched).toEqual([]);
  });

  it('streams the beta pointer for beta', async () => {
    const { bucket } = createBucket(RELEASED);
    const response = await respond(createRequest('/download/beta/'), createWorld({ bucket }).world);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="Shinsa-1.3.0-beta.2.dmg"'
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(DMG_BYTES);
  });

  it('serves the beta at /download while there is no stable release', async () => {
    const { bucket, calls } = createBucket(storeChannels([['beta', pointerOf('1.0.0-beta.1')]]));
    const response = await respond(createRequest('/download'), createWorld({ bucket }).world);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="Shinsa-1.0.0-beta.1.dmg"'
    );
    expect(calls.map((call) => call.key)).toEqual([
      'channels/stable.json',
      'channels/beta.json',
      'releases/1.0.0-beta.1/Shinsa-mac-arm64.dmg',
    ]);
  });

  it('answers HEAD from the pointer and a check that the file is there, reading no bytes', async () => {
    const { bucket, calls } = createBucket(RELEASED);
    const response = await respond(
      createRequest('/download/beta', { Range: 'bytes=100-' }, 'HEAD'),
      createWorld({ bucket }).world
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBe(String(DMG_BYTES.length));
    expect(response.headers.get('Content-Type')).toBe('application/x-apple-diskimage');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.body).toBeNull();
    expect(calls.at(-1)).toEqual({ method: 'head', key: 'releases/1.3.0-beta.2/Shinsa-mac-arm64.dmg' });
  });

  it('reads only the requested range, so a download can resume', async () => {
    const { bucket, calls } = createBucket(RELEASED);
    const response = await respond(
      createRequest('/download', { Range: 'bytes=4-' }),
      createWorld({ bucket }).world
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe(`bytes 4-7/${DMG_BYTES.length}`);
    expect(response.headers.get('Content-Length')).toBe('4');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(DMG_BYTES.slice(4));
    expect(calls.at(-1)?.range).toEqual({ offset: 4, length: 4 });
  });

  it('honours If-Range: the range when the file is unchanged, the whole file when it is not', async () => {
    const { bucket } = createBucket(RELEASED);
    const { world } = createWorld({ bucket });
    const byTag = await respond(
      createRequest('/download', { Range: 'bytes=-2', 'If-Range': `"${SHA}"` }),
      world
    );
    expect(byTag.status).toBe(206);
    expect(byTag.headers.get('Content-Range')).toBe('bytes 6-7/8');
    const byDate = await respond(
      createRequest('/download', { Range: 'bytes=0-0', 'If-Range': LAST_MODIFIED }),
      world
    );
    expect(byDate.status).toBe(206);
    for (const ifRange of ['"other"', `W/"${SHA}"`, EARLIER]) {
      const changed = await respond(
        createRequest('/download', { Range: 'bytes=4-', 'If-Range': ifRange }),
        world
      );
      expect(changed.status).toBe(200);
      expect(new Uint8Array(await changed.arrayBuffer())).toEqual(DMG_BYTES);
    }
  });

  it('answers an unsatisfiable range with 416 and the size, without reading the file', async () => {
    const { bucket, calls } = createBucket(RELEASED);
    const response = await respond(
      createRequest('/download', { Range: 'bytes=100-' }),
      createWorld({ bucket }).world
    );
    expect(response.status).toBe(416);
    expect(response.headers.get('Content-Range')).toBe(`bytes */${DMG_BYTES.length}`);
    expect(await response.text()).toBe('');
    expect(calls).toHaveLength(1);
  });

  it('answers a conditional request for the file it already has with 304', async () => {
    const { bucket, calls } = createBucket(RELEASED);
    const { world } = createWorld({ bucket });
    for (const headers of [
      { 'If-None-Match': `W/"${SHA}"` },
      { 'If-None-Match': `"other", "${SHA}"` },
      { 'If-None-Match': '*' },
      { 'If-Modified-Since': LAST_MODIFIED },
      { 'If-Match': `"${SHA}"`, 'If-None-Match': `"${SHA}"` },
    ] as Conditions) {
      const response = await respond(createRequest('/download', headers), world);
      expect(response.status).toBe(304);
      expect(response.headers.get('ETag')).toBe(`"${SHA}"`);
      expect(response.body).toBeNull();
    }
    expect(calls.every((call) => call.key === 'channels/stable.json')).toBe(true);
  });

  it('sends the file when the condition does not hold', async () => {
    const { bucket } = createBucket(RELEASED);
    const { world } = createWorld({ bucket });
    for (const headers of [
      { 'If-None-Match': '"other"' },
      { 'If-Modified-Since': EARLIER },
      { 'If-Modified-Since': 'not a date' },
      { 'If-Match': '*' },
      { 'If-Unmodified-Since': LAST_MODIFIED },
      { 'If-Match': `"${SHA}"`, 'If-Unmodified-Since': EARLIER },
    ] as Conditions) {
      expect((await respond(createRequest('/download', headers), world)).status).toBe(200);
    }
  });

  it('refuses a request whose precondition fails with 412', async () => {
    const { bucket } = createBucket(RELEASED);
    const { world } = createWorld({ bucket });
    for (const headers of [
      { 'If-Match': '"other"' },
      { 'If-Match': `W/"${SHA}"` },
      { 'If-Unmodified-Since': EARLIER },
    ] as Conditions) {
      const response = await respond(createRequest('/download', headers), world);
      expect(response.status).toBe(412);
      expect(response.body).toBeNull();
    }
  });

  it('keeps the pointer a minute at the edge, so a download reads only the file', async () => {
    const { cache, entries } = createCache();
    const { bucket, calls } = createBucket(RELEASED);
    const { world } = createWorld({ bucket, cache });
    await respond(createRequest('/download'), world);
    await respond(createRequest('/download'), world);
    expect(calls.filter((call) => call.key === 'channels/stable.json')).toHaveLength(1);
    expect(entries.get(resolvePointerCacheKey('stable'))?.headers.get('Cache-Control')).toBe('max-age=60');
  });
});

describe('respond when the bucket cannot serve', () => {
  const betaOnly = answerFeed(['v1.0.0-beta.2', 'v1.0.0-beta.11', 'v1.0.0-beta.3']);

  const pointerWithoutFile = { [resolveChannelKey('beta')]: JSON.stringify(pointerOf('1.0.0-beta.4')) };

  async function expectRedirect(response: Response, location: string) {
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(location);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('');
  }

  it('redirects to the newest release on GitHub when the bucket has no pointer for the channel', async () => {
    const { bucket } = createBucket({});
    const { world, fetched } = createWorld({ bucket, answer: betaOnly });
    await expectRedirect(await respond(createRequest('/download/beta'), world), dmgUrl('v1.0.0-beta.11'));
    expect(fetched[0]?.url).toBe(RELEASES_FEED);
    expect(new Headers(fetched[0]?.init.headers).get('User-Agent')).toBe('shinsa.dev');
  });

  it('redirects when the worker has no bucket, as before the binding exists', async () => {
    const { world } = createWorld({ answer: betaOnly });
    await expectRedirect(await respond(createRequest('/download/beta'), world), dmgUrl('v1.0.0-beta.11'));
  });

  it('redirects when the bucket fails, a pointer is unreadable or its file is missing', async () => {
    const buckets = [
      createBucket(RELEASED, new Error('R2 is down')).bucket,
      createBucket(storeChannels([['beta', 'not json']])).bucket,
      createBucket(storeChannels([['beta', '{"version":"1.0.0"}']])).bucket,
      createBucket(pointerWithoutFile).bucket,
    ];
    for (const bucket of buckets) {
      const { world } = createWorld({ bucket, answer: betaOnly });
      await expectRedirect(await respond(createRequest('/download/beta'), world), dmgUrl('v1.0.0-beta.11'));
    }
    const { world } = createWorld({ bucket: createBucket(pointerWithoutFile).bucket, answer: betaOnly });
    await expectRedirect(
      await respond(createRequest('/download/beta', {}, 'HEAD'), world),
      dmgUrl('v1.0.0-beta.11')
    );
  });

  it('sends /download to GitHub’s latest release once the feed shows a stable one', async () => {
    const { world } = createWorld({ answer: answerFeed(['v1.1.0-beta.1', 'v1.0.0']) });
    await expectRedirect(await respond(createRequest('/download'), world), LATEST_STABLE_URL);
  });

  it('sends /download to the newest beta while the feed shows no stable release', async () => {
    const { world } = createWorld({ answer: betaOnly });
    await expectRedirect(await respond(createRequest('/download'), world), dmgUrl('v1.0.0-beta.11'));
  });

  it('falls back to the latest release and the releases page when the feed fails too', async () => {
    const answers: Answer[] = [
      unreachable,
      () => Promise.resolve(new Response('rate limited', { status: 429 })),
      answerFeed(['nightly']),
    ];
    for (const answer of answers) {
      const { world } = createWorld({ answer });
      await expectRedirect(await respond(createRequest('/download'), world), LATEST_STABLE_URL);
      await expectRedirect(await respond(createRequest('/download/beta'), world), RELEASES_PAGE);
    }
  });

  it('keeps the feed a minute at the edge and nothing when it fails', async () => {
    const { cache, entries } = createCache();
    const { world, fetched } = createWorld({ answer: betaOnly, cache });
    await respond(createRequest('/download/beta'), world);
    await respond(createRequest('/download/beta'), world);
    expect(fetched).toHaveLength(1);
    expect(entries.get(FEED_CACHE_KEY)?.headers.get('Cache-Control')).toBe('max-age=60');
    const failing = createCache();
    await respond(createRequest('/download/beta'), createWorld({ cache: failing.cache }).world);
    expect(failing.entries.size).toBe(0);
  });
});

describe('respond to other paths', () => {
  it('serves every other path from the static assets', async () => {
    const { bucket, calls } = createBucket(RELEASED);
    const { world, fetched, pages } = createWorld({ bucket });
    expect(await (await respond(createRequest('/download/other'), world)).text()).toBe(
      'page /download/other'
    );
    expect(pages).toEqual(['/download/other']);
    expect(calls).toEqual([]);
    expect(fetched).toEqual([]);
  });
});
