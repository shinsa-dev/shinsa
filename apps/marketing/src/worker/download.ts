import { isPrereleaseVersion, resolveVersionOrder } from '@shinsa/core';

export type Channel = 'stable' | 'beta';

export interface DownloadPointer {
  version: string;
  key: string;
  size: number;
  sha256: string;
  publishedAt: string;
}

export interface ByteRange {
  offset: number;
  length: number;
}

interface DownloadObject {
  body: ReadableStream | null;
  text: () => Promise<string>;
}

export interface DownloadBucket {
  head: (key: string) => Promise<object | null>;
  get: (key: string, options?: { range?: ByteRange }) => Promise<DownloadObject | null>;
}

export interface DownloadCache {
  match: (key: string) => Promise<Response | undefined>;
  put: (key: string, response: Response) => Promise<void>;
}

export interface DownloadWorld {
  bucket: DownloadBucket | null;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  cache: DownloadCache | null;
  assets: (request: Request) => Promise<Response>;
}

interface Validators {
  etag: string;
  lastModified: string;
  modifiedSeconds: number;
}

export const DMG_NAME = 'Shinsa-mac-arm64.dmg';

const REPOSITORY_URL = 'https://github.com/shinsa-dev/shinsa';

export const RELEASES_PAGE = `${REPOSITORY_URL}/releases`;

export const RELEASES_FEED = `${REPOSITORY_URL}/releases.atom`;

export const LATEST_STABLE_URL = `${REPOSITORY_URL}/releases/latest/download/${DMG_NAME}`;

const CACHE_ORIGIN = 'https://shinsa.dev/cache/download';

export const FEED_CACHE_KEY = `${CACHE_ORIGIN}/feed`;

const CACHE_SECONDS = 60;

const DMG_HEADERS = {
  'Content-Type': 'application/x-apple-diskimage',
  'Accept-Ranges': 'bytes',
  'Cache-Control': 'public, max-age=300',
  'X-Content-Type-Options': 'nosniff',
};

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

const FEED_TAG_PATTERN = /\/releases\/tag\/([^"<>\s]+)"/g;

export function resolveChannel(pathname: string): Channel | null {
  const path = pathname.replace(/\/+$/, '');
  if (path === '/download') return 'stable';
  if (path === '/download/beta') return 'beta';
  return null;
}

export function resolveChannelKey(channel: Channel) {
  return `channels/${channel}.json`;
}

export function resolveReleaseKey(version: string) {
  return `releases/${version}/${DMG_NAME}`;
}

export function resolvePointerCacheKey(channel: Channel) {
  return `${CACHE_ORIGIN}/${resolveChannelKey(channel)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isVersion(value: unknown): value is string {
  return typeof value === 'string' && resolveVersionOrder(value, value) === 0;
}

export function parseDownloadPointer(value: unknown): DownloadPointer | null {
  if (!isRecord(value)) return null;
  const { version, key, size, sha256, publishedAt } = value;
  if (!isVersion(version) || typeof key !== 'string' || key === '') return null;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) return null;
  if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) return null;
  if (typeof publishedAt !== 'string' || Number.isNaN(Date.parse(publishedAt))) return null;
  return { version, key, size, sha256, publishedAt };
}

async function resolveCached<T>(world: DownloadWorld, key: string, produce: () => Promise<T | null>) {
  const cached = await world.cache?.match(key);
  if (cached) return (await cached.json()) as T;
  const value = await produce();
  if (value === null) return null;
  const headers = { 'Cache-Control': `max-age=${CACHE_SECONDS}` };
  await world.cache?.put(key, Response.json(value, { headers }));
  return value;
}

async function requestPointer(bucket: DownloadBucket, channel: Channel) {
  const object = await bucket.get(resolveChannelKey(channel));
  if (!object) return null;
  return parseDownloadPointer(JSON.parse(await object.text()));
}

function selectPointer(bucket: DownloadBucket, channel: Channel, world: DownloadWorld) {
  return resolveCached(world, resolvePointerCacheKey(channel), () => requestPointer(bucket, channel));
}

async function resolveDownloadPointer(bucket: DownloadBucket, channel: Channel, world: DownloadWorld) {
  const pointer = await selectPointer(bucket, channel, world);
  if (pointer || channel === 'beta') return pointer;
  return selectPointer(bucket, 'beta', world);
}

export function parseRange(header: string, size: number): ByteRange | 'unsatisfiable' | null {
  const match = RANGE_PATTERN.exec(header.trim());
  if (!match) return null;
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return null;
  if (first === '') {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    const offset = Math.max(0, size - suffix);
    return { offset, length: size - offset };
  }
  const offset = Number(first);
  if (offset >= size) return 'unsatisfiable';
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  if (end < offset) return null;
  return { offset, length: end - offset + 1 };
}

function listEntityTags(header: string) {
  return header.split(',').map((tag) => tag.trim());
}

function matchesStrong(header: string, etag: string) {
  return listEntityTags(header).some((tag) => tag === '*' || tag === etag);
}

function matchesWeak(header: string, etag: string) {
  return listEntityTags(header).some((tag) => tag === '*' || tag.replace(/^W\//, '') === etag);
}

function parseSeconds(header: string | null) {
  if (header === null) return null;
  const time = Date.parse(header);
  return Number.isNaN(time) ? null : Math.floor(time / 1000);
}

function resolveValidators(pointer: DownloadPointer): Validators {
  const modified = new Date(pointer.publishedAt);
  return {
    etag: `"${pointer.sha256}"`,
    lastModified: modified.toUTCString(),
    modifiedSeconds: Math.floor(modified.getTime() / 1000),
  };
}

function resolvePrecondition(headers: Headers, validators: Validators): 304 | 412 | null {
  const ifMatch = headers.get('if-match');
  const unmodifiedSince = parseSeconds(headers.get('if-unmodified-since'));
  if (ifMatch !== null && !matchesStrong(ifMatch, validators.etag)) return 412;
  if (ifMatch === null && unmodifiedSince !== null && validators.modifiedSeconds > unmodifiedSince)
    return 412;
  const ifNoneMatch = headers.get('if-none-match');
  if (ifNoneMatch !== null) return matchesWeak(ifNoneMatch, validators.etag) ? 304 : null;
  const modifiedSince = parseSeconds(headers.get('if-modified-since'));
  if (modifiedSince !== null && validators.modifiedSeconds <= modifiedSince) return 304;
  return null;
}

function matchesIfRange(header: string | null, validators: Validators) {
  if (header === null) return true;
  if (header.startsWith('"') || header.startsWith('W/')) return header === validators.etag;
  return parseSeconds(header) === validators.modifiedSeconds;
}

function resolveRequestedRange(request: Request, pointer: DownloadPointer, validators: Validators) {
  const header = request.headers.get('range');
  if (request.method === 'HEAD' || header === null) return null;
  if (!matchesIfRange(request.headers.get('if-range'), validators)) return null;
  return parseRange(header, pointer.size);
}

function createDmgHeaders(pointer: DownloadPointer, validators: Validators) {
  return new Headers({
    ...DMG_HEADERS,
    'Content-Disposition': `attachment; filename="Shinsa-${pointer.version}.dmg"`,
    ETag: validators.etag,
    'Last-Modified': validators.lastModified,
  });
}

async function streamPointer(request: Request, pointer: DownloadPointer, bucket: DownloadBucket) {
  const validators = resolveValidators(pointer);
  const headers = createDmgHeaders(pointer, validators);
  const precondition = resolvePrecondition(request.headers, validators);
  if (precondition) return new Response(null, { status: precondition, headers });
  const range = resolveRequestedRange(request, pointer, validators);
  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${pointer.size}`);
    return new Response(null, { status: 416, headers });
  }
  if (request.method === 'HEAD') {
    if (!(await bucket.head(pointer.key))) return null;
    headers.set('Content-Length', String(pointer.size));
    return new Response(null, { status: 200, headers });
  }
  const object = await bucket.get(pointer.key, range ? { range } : undefined);
  if (!object) return null;
  if (!range) {
    headers.set('Content-Length', String(pointer.size));
    return new Response(object.body, { status: 200, headers });
  }
  headers.set('Content-Length', String(range.length));
  headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${pointer.size}`);
  return new Response(object.body, { status: 206, headers });
}

async function streamFromBucket(request: Request, channel: Channel, world: DownloadWorld) {
  if (!world.bucket) return null;
  try {
    const pointer = await resolveDownloadPointer(world.bucket, channel, world);
    if (!pointer) return null;
    return await streamPointer(request, pointer, world.bucket);
  } catch {
    return null;
  }
}

export function listFeedVersions(feed: string) {
  return Array.from(feed.matchAll(FEED_TAG_PATTERN), (match) => match[1]).filter(isVersion);
}

function selectNewest(tags: string[]) {
  return tags.reduce((newest, tag) => (resolveVersionOrder(tag, newest) === 1 ? tag : newest));
}

async function requestFeedVersions(world: DownloadWorld) {
  const response = await world.fetch(RELEASES_FEED, {
    headers: { Accept: 'application/atom+xml', 'User-Agent': 'shinsa.dev' },
  });
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  const tags = listFeedVersions(await response.text());
  return tags.length > 0 ? tags : null;
}

async function resolveFeedVersions(world: DownloadWorld) {
  try {
    return await resolveCached(world, FEED_CACHE_KEY, () => requestFeedVersions(world));
  } catch {
    return null;
  }
}

async function resolveFallbackUrl(channel: Channel, world: DownloadWorld) {
  const tags = await resolveFeedVersions(world);
  if (!tags) return channel === 'stable' ? LATEST_STABLE_URL : RELEASES_PAGE;
  if (channel === 'stable' && tags.some((tag) => !isPrereleaseVersion(tag))) return LATEST_STABLE_URL;
  return `${REPOSITORY_URL}/releases/download/${selectNewest(tags)}/${DMG_NAME}`;
}

async function redirectToGitHub(channel: Channel, world: DownloadWorld) {
  const location = await resolveFallbackUrl(channel, world);
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

export async function respond(request: Request, world: DownloadWorld) {
  const channel = resolveChannel(new URL(request.url).pathname);
  if (!channel) return world.assets(request);
  const download = await streamFromBucket(request, channel, world);
  return download ?? redirectToGitHub(channel, world);
}
