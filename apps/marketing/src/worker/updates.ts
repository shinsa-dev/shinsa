import { type ByteRange, type Channel, isVersion, parseRange } from './download.ts';
import { recordFailure } from './log.ts';

interface UpdateObject {
  size: number;
  httpEtag: string;
  uploaded: Date;
}

export interface UpdateBucket {
  head: (key: string) => Promise<UpdateObject | null>;
  get: (key: string, options?: { range?: ByteRange }) => Promise<{ body: ReadableStream | null } | null>;
}

interface UpdateFile {
  key: string;
  contentType: string;
  cacheControl: string;
}

const UPDATES_PATH = '/updates';

const UPDATES_PREFIX = 'updates/';

export const ZIP_NAME = 'Shinsa-mac-arm64.zip';

export const BLOCKMAP_NAME = `${ZIP_NAME}.blockmap`;

export const UPDATE_CHANNEL_FILES: Record<Channel, string> = {
  stable: 'latest-mac.yml',
  beta: 'beta-mac.yml',
  canary: 'canary-mac.yml',
};

const CHANNEL_FILE_CACHE = 'public, max-age=60';

const BUILD_FILE_CACHE = 'public, max-age=31536000, immutable';

const BUILD_CONTENT_TYPES: Record<string, string> = {
  [ZIP_NAME]: 'application/zip',
  [BLOCKMAP_NAME]: 'application/octet-stream',
};

export function isUpdatePath(pathname: string) {
  return pathname === UPDATES_PATH || pathname.startsWith(`${UPDATES_PATH}/`);
}

export function resolveUpdateKey(name: string) {
  return `${UPDATES_PREFIX}${name}`;
}

export function resolveBuildKey(version: string, name: string) {
  return `releases/${version}/${name}`;
}

export function resolveUpdateFile(pathname: string): UpdateFile | null {
  const parts = pathname.slice(UPDATES_PATH.length + 1).split('/');
  if (parts.length === 1) {
    const [name = ''] = parts;
    if (!Object.values(UPDATE_CHANNEL_FILES).includes(name)) return null;
    return {
      key: resolveUpdateKey(name),
      contentType: 'text/yaml; charset=utf-8',
      cacheControl: CHANNEL_FILE_CACHE,
    };
  }
  const [version, name = '', ...rest] = parts;
  const contentType = BUILD_CONTENT_TYPES[name];
  if (rest.length > 0 || !isVersion(version) || !contentType) return null;
  return { key: resolveBuildKey(version, name), contentType, cacheControl: BUILD_FILE_CACHE };
}

function createUpdateHeaders(file: UpdateFile, object: UpdateObject) {
  return new Headers({
    'Content-Type': file.contentType,
    'Cache-Control': file.cacheControl,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    ETag: object.httpEtag,
    'Last-Modified': object.uploaded.toUTCString(),
  });
}

function answerStatus(status: number, headers: Record<string, string> = {}) {
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

async function streamUpdateFile(request: Request, file: UpdateFile, bucket: UpdateBucket) {
  const object = await bucket.head(file.key);
  if (!object) return answerStatus(404);
  const headers = createUpdateHeaders(file, object);
  const header = request.headers.get('range');
  const range = request.method === 'GET' && header !== null ? parseRange(header, object.size) : null;
  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${object.size}`);
    return new Response(null, { status: 416, headers });
  }
  if (request.method === 'HEAD') {
    headers.set('Content-Length', String(object.size));
    return new Response(null, { status: 200, headers });
  }
  const read = await bucket.get(file.key, range ? { range } : undefined);
  if (!read) return answerStatus(404);
  if (!range) {
    headers.set('Content-Length', String(object.size));
    return new Response(read.body, { status: 200, headers });
  }
  headers.set('Content-Length', String(range.length));
  headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
  return new Response(read.body, { status: 206, headers });
}

export async function respondUpdate(request: Request, bucket: UpdateBucket | null) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return answerStatus(405, { Allow: 'GET, HEAD' });
  const file = resolveUpdateFile(new URL(request.url).pathname);
  if (!file) return answerStatus(404);
  if (!bucket) {
    recordFailure('Update files have no R2 binding', { key: file.key });
    return answerStatus(503);
  }
  try {
    return await streamUpdateFile(request, file, bucket);
  } catch (error) {
    recordFailure('Update file read from R2 failed', { key: file.key, error: String(error) });
    return answerStatus(503);
  }
}
