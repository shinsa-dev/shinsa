import { describe, expect, it } from 'bun:test';
import type { ByteRange } from '../../src/worker/download.ts';
import {
  isUpdatePath,
  resolveBuildKey,
  resolveUpdateFile,
  resolveUpdateKey,
  respondUpdate,
  type UpdateBucket,
} from '../../src/worker/updates.ts';

const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f]);

const UPLOADED = new Date('2026-10-27T12:11:13Z');

const CHANNEL_FILE = 'version: 1.0.0-beta.6\npath: 1.0.0-beta.6/Shinsa-mac-arm64.zip\n';

const ZIP_KEY = 'releases/1.0.0-beta.6/Shinsa-mac-arm64.zip';

interface BucketCall {
  method: 'get' | 'head';
  key: string;
  range?: ByteRange;
}

function createBucket(objects: Record<string, string | Uint8Array>, failure?: Error) {
  const calls: BucketCall[] = [];
  const storedBytes = (key: string) => {
    const stored = objects[key];
    if (stored === undefined) return null;
    return typeof stored === 'string' ? new TextEncoder().encode(stored) : stored;
  };
  const bucket: UpdateBucket = {
    head: async (key) => {
      calls.push({ method: 'head', key });
      if (failure) throw failure;
      const bytes = storedBytes(key);
      return bytes ? { size: bytes.length, httpEtag: `"etag-${key}"`, uploaded: UPLOADED } : null;
    },
    get: async (key, options) => {
      calls.push({ method: 'get', key, ...(options?.range ? { range: options.range } : {}) });
      const bytes = storedBytes(key);
      if (!bytes) return null;
      const range = options?.range ?? { offset: 0, length: bytes.length };
      return { body: new Response(bytes.slice(range.offset, range.offset + range.length)).body };
    },
  };
  return { bucket, calls };
}

const STORED = {
  'updates/beta-mac.yml': CHANNEL_FILE,
  [ZIP_KEY]: ZIP_BYTES,
  [`${ZIP_KEY}.blockmap`]: 'blockmap',
};

function createRequest(path: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Request(`https://shinsa.dev${path}`, { method, headers });
}

async function bytesOf(response: Response) {
  return new Uint8Array(await response.arrayBuffer());
}

describe('isUpdatePath', () => {
  it('takes /updates and everything under it', () => {
    expect(isUpdatePath('/updates')).toBe(true);
    expect(isUpdatePath('/updates/latest-mac.yml')).toBe(true);
    expect(isUpdatePath('/updates/1.0.0/Shinsa-mac-arm64.zip')).toBe(true);
  });

  it('leaves every other path alone', () => {
    expect(isUpdatePath('/')).toBe(false);
    expect(isUpdatePath('/updatesx')).toBe(false);
    expect(isUpdatePath('/download/beta')).toBe(false);
  });
});

describe('the update file layout', () => {
  it('keeps the channel files under updates/ and every build under its version', () => {
    expect(resolveUpdateKey('latest-mac.yml')).toBe('updates/latest-mac.yml');
    expect(resolveBuildKey('1.0.0', 'Shinsa-mac-arm64.zip')).toBe('releases/1.0.0/Shinsa-mac-arm64.zip');
  });

  it('serves the three channel files, short-lived', () => {
    for (const name of ['latest-mac.yml', 'beta-mac.yml', 'canary-mac.yml']) {
      expect(resolveUpdateFile(`/updates/${name}`)).toEqual({
        key: `updates/${name}`,
        contentType: 'text/yaml; charset=utf-8',
        cacheControl: 'public, max-age=60',
      });
    }
  });

  it('serves the zip and its blockmap of any version, cached for good', () => {
    expect(resolveUpdateFile('/updates/1.0.0-canary.42/Shinsa-mac-arm64.zip')).toEqual({
      key: 'releases/1.0.0-canary.42/Shinsa-mac-arm64.zip',
      contentType: 'application/zip',
      cacheControl: 'public, max-age=31536000, immutable',
    });
    expect(resolveUpdateFile('/updates/1.0.0/Shinsa-mac-arm64.zip.blockmap')).toEqual({
      key: 'releases/1.0.0/Shinsa-mac-arm64.zip.blockmap',
      contentType: 'application/octet-stream',
      cacheControl: 'public, max-age=31536000, immutable',
    });
  });

  it('refuses everything else, so no other object in the bucket is reachable', () => {
    for (const path of [
      '/updates',
      '/updates/',
      '/updates/nightly-mac.yml',
      '/updates/channels/stable.json',
      '/updates/1.0.0/Shinsa-mac-arm64.dmg',
      '/updates/latest/Shinsa-mac-arm64.zip',
      '/updates/../channels/Shinsa-mac-arm64.zip',
      '/updates/1.0.0/Shinsa-mac-arm64.zip/more',
      '/updates/1.0.0',
    ]) {
      expect(resolveUpdateFile(path)).toBeNull();
    }
  });
});

describe('respondUpdate', () => {
  it('serves a channel file whole', async () => {
    const { bucket, calls } = createBucket(STORED);
    const response = await respondUpdate(createRequest('/updates/beta-mac.yml'), bucket);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/yaml; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(response.headers.get('Content-Length')).toBe(String(CHANNEL_FILE.length));
    expect(response.headers.get('ETag')).toBe('"etag-updates/beta-mac.yml"');
    expect(response.headers.get('Last-Modified')).toBe('Tue, 27 Oct 2026 12:11:13 GMT');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await response.text()).toBe(CHANNEL_FILE);
    expect(calls).toEqual([
      { method: 'head', key: 'updates/beta-mac.yml' },
      { method: 'get', key: 'updates/beta-mac.yml' },
    ]);
  });

  it('serves a zip whole, with ranges on offer', async () => {
    const { bucket } = createBucket(STORED);
    const response = await respondUpdate(createRequest('/updates/1.0.0-beta.6/Shinsa-mac-arm64.zip'), bucket);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/zip');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(await bytesOf(response)).toEqual(ZIP_BYTES);
  });

  it('reads only the bytes of a single range, as a differential update asks', async () => {
    const { bucket, calls } = createBucket(STORED);
    const request = createRequest('/updates/1.0.0-beta.6/Shinsa-mac-arm64.zip', { Range: 'bytes=2-5' });
    const response = await respondUpdate(request, bucket);
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 2-5/10');
    expect(response.headers.get('Content-Length')).toBe('4');
    expect(await bytesOf(response)).toEqual(ZIP_BYTES.slice(2, 6));
    expect(calls.at(-1)).toEqual({ method: 'get', key: ZIP_KEY, range: { offset: 2, length: 4 } });
  });

  it('answers 416 for a range past the end', async () => {
    const { bucket } = createBucket(STORED);
    const request = createRequest('/updates/1.0.0-beta.6/Shinsa-mac-arm64.zip', { Range: 'bytes=40-' });
    const response = await respondUpdate(request, bucket);
    expect(response.status).toBe(416);
    expect(response.headers.get('Content-Range')).toBe('bytes */10');
  });

  it('sends the whole file for a malformed or multiple range', async () => {
    const { bucket } = createBucket(STORED);
    for (const range of ['bytes=0-1,4-5', 'chunks=1']) {
      const request = createRequest('/updates/1.0.0-beta.6/Shinsa-mac-arm64.zip', { Range: range });
      const response = await respondUpdate(request, bucket);
      expect(response.status).toBe(200);
      expect(await bytesOf(response)).toEqual(ZIP_BYTES);
    }
  });

  it('answers a HEAD from the object alone, reading no bytes', async () => {
    const { bucket, calls } = createBucket(STORED);
    const request = createRequest(
      '/updates/1.0.0-beta.6/Shinsa-mac-arm64.zip.blockmap',
      { Range: 'bytes=0-1' },
      'HEAD'
    );
    const response = await respondUpdate(request, bucket);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBe('8');
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(calls).toEqual([{ method: 'head', key: `${ZIP_KEY}.blockmap` }]);
  });

  it('answers 404 for a path it does not serve or a file not in the bucket', async () => {
    const { bucket, calls } = createBucket(STORED);
    for (const path of [
      '/updates/nightly-mac.yml',
      '/updates/latest-mac.yml',
      '/updates/9.9.9/Shinsa-mac-arm64.zip',
    ]) {
      const response = await respondUpdate(createRequest(path), bucket);
      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(calls.map((call) => call.key)).toEqual([
      'updates/latest-mac.yml',
      'releases/9.9.9/Shinsa-mac-arm64.zip',
    ]);
  });

  it('answers 404 when the file goes between the head and the read', async () => {
    const { bucket } = createBucket(STORED);
    const vanishing: UpdateBucket = { head: bucket.head, get: async () => null };
    const response = await respondUpdate(createRequest('/updates/beta-mac.yml'), vanishing);
    expect(response.status).toBe(404);
  });

  it('answers 503 without a bucket or when R2 fails, so the app tries again later', async () => {
    const withoutBucket = await respondUpdate(createRequest('/updates/beta-mac.yml'), null);
    expect(withoutBucket.status).toBe(503);
    const { bucket } = createBucket(STORED, new Error('R2 down'));
    const failing = await respondUpdate(createRequest('/updates/beta-mac.yml'), bucket);
    expect(failing.status).toBe(503);
    expect(failing.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers 405 to anything but GET and HEAD', async () => {
    const { bucket, calls } = createBucket(STORED);
    const response = await respondUpdate(createRequest('/updates/beta-mac.yml', {}, 'PUT'), bucket);
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
    expect(calls).toEqual([]);
  });
});
