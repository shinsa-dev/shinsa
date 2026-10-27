export type Channel = 'stable' | 'beta';

type Identifier = string | number;

export interface Version {
  core: [number, number, number];
  prerelease: Identifier[];
}

export interface Asset {
  version: string;
  url: string;
  size: number;
}

export interface Releases {
  stable: Asset | null;
  beta: Asset | null;
}

interface Candidate {
  version: Version;
  prerelease: boolean;
  asset: Asset;
}

export interface DownloadCache {
  match: (key: string) => Promise<Response | undefined>;
  put: (key: string, response: Response) => Promise<void>;
}

export interface DownloadWorld {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  cache: DownloadCache | null;
  assets: (request: Request) => Promise<Response>;
}

const DMG_NAME = 'Shinsa-mac-arm64.dmg';

export const RELEASES_API = 'https://api.github.com/repos/shinsa-dev/shinsa/releases?per_page=30';

export const RELEASES_CACHE_KEY = 'https://shinsa.dev/cache/download/releases';

const RELEASES_CACHE_SECONDS = 300;

export const NO_STABLE_PAGE = '/download/no-stable-release';

export const UNAVAILABLE_PAGE = '/download/unavailable';

const RETRY_SECONDS = 300;

const DMG_HEADERS = {
  'Content-Type': 'application/x-apple-diskimage',
  'Accept-Ranges': 'bytes',
  'Cache-Control': 'public, max-age=300',
  'X-Content-Type-Options': 'nosniff',
};

const FORWARDED_REQUEST_HEADERS = ['range', 'if-range'];

const FORWARDED_RESPONSE_HEADERS = ['content-length', 'content-range', 'etag', 'last-modified'];

const PASSED_STATUSES = new Set([200, 206, 416]);

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function resolveChannel(pathname: string): Channel | null {
  const path = pathname.replace(/\/+$/, '');
  if (path === '/download') return 'stable';
  if (path === '/download/beta') return 'beta';
  return null;
}

function parseIdentifier(part: string): Identifier {
  return /^\d+$/.test(part) ? Number(part) : part;
}

export function parseVersion(tag: string): Version | null {
  const match = VERSION_PATTERN.exec(tag);
  if (!match) return null;
  const [, major, minor, patch, prerelease] = match;
  return {
    core: [Number(major), Number(minor), Number(patch)],
    prerelease: prerelease ? prerelease.split('.').map(parseIdentifier) : [],
  };
}

function compareIdentifiers(a: Identifier, b: Identifier) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function compareVersions(a: Version, b: Version) {
  for (const index of [0, 1, 2] as const) {
    const difference = a.core[index] - b.core[index];
    if (difference !== 0) return difference;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0)
    return b.prerelease.length - a.prerelease.length;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const left = a.prerelease[index];
    const right = b.prerelease[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const difference = compareIdentifiers(left, right);
    if (difference !== 0) return difference;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function selectDmg(assets: unknown) {
  if (!Array.isArray(assets)) return null;
  for (const asset of assets) {
    if (!isRecord(asset) || asset.name !== DMG_NAME) continue;
    if (typeof asset.browser_download_url === 'string' && typeof asset.size === 'number')
      return { url: asset.browser_download_url, size: asset.size };
  }
  return null;
}

function selectCandidate(entry: unknown): Candidate | null {
  if (!isRecord(entry) || entry.draft !== false || typeof entry.tag_name !== 'string') return null;
  const version = parseVersion(entry.tag_name);
  const dmg = selectDmg(entry.assets);
  if (!(version && dmg)) return null;
  return {
    version,
    prerelease: entry.prerelease !== false,
    asset: { version: entry.tag_name.replace(/^v/, ''), ...dmg },
  };
}

function selectNewest(candidates: Candidate[]) {
  let newest: Candidate | null = null;
  for (const candidate of candidates) {
    if (!newest || compareVersions(candidate.version, newest.version) > 0) newest = candidate;
  }
  return newest?.asset ?? null;
}

export function resolveReleases(body: unknown): Releases | null {
  if (!Array.isArray(body)) return null;
  const candidates = body.map(selectCandidate).filter((candidate) => candidate !== null);
  return {
    stable: selectNewest(candidates.filter((candidate) => !candidate.prerelease)),
    beta: selectNewest(candidates),
  };
}

async function requestReleases(world: DownloadWorld) {
  const response = await world.fetch(RELEASES_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'shinsa.dev',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) return null;
  return resolveReleases(await response.json());
}

export async function resolveCachedReleases(world: DownloadWorld): Promise<Releases | null> {
  try {
    const cached = await world.cache?.match(RELEASES_CACHE_KEY);
    if (cached) return await cached.json();
    const releases = await requestReleases(world);
    if (!releases) return null;
    await world.cache?.put(
      RELEASES_CACHE_KEY,
      Response.json(releases, { headers: { 'Cache-Control': `max-age=${RELEASES_CACHE_SECONDS}` } })
    );
    return releases;
  } catch {
    return null;
  }
}

function forwardHeaders(names: string[], from: Headers, to: Headers) {
  for (const name of names) {
    const value = from.get(name);
    if (value !== null) to.set(name, value);
  }
  return to;
}

async function requestAsset(request: Request, asset: Asset, world: DownloadWorld) {
  const headers = forwardHeaders(
    FORWARDED_REQUEST_HEADERS,
    request.headers,
    new Headers({ 'User-Agent': 'shinsa.dev' })
  );
  try {
    const upstream = await world.fetch(asset.url, { headers, redirect: 'follow' });
    if (PASSED_STATUSES.has(upstream.status)) return upstream;
    await upstream.body?.cancel();
    return null;
  } catch {
    return null;
  }
}

async function streamAsset(request: Request, asset: Asset, world: DownloadWorld) {
  const headers = new Headers(DMG_HEADERS);
  headers.set('Content-Disposition', `attachment; filename="Shinsa-${asset.version}.dmg"`);
  if (request.method === 'HEAD') {
    headers.set('Content-Length', String(asset.size));
    return new Response(null, { status: 200, headers });
  }
  const upstream = await requestAsset(request, asset, world);
  if (!upstream) return null;
  forwardHeaders(FORWARDED_RESPONSE_HEADERS, upstream.headers, headers);
  if (upstream.status === 416) {
    await upstream.body?.cancel();
    return new Response(null, { status: 416, headers });
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function respondWithPage(request: Request, page: string, status: 404 | 503, world: DownloadWorld) {
  const answer = await world.assets(new Request(new URL(page, request.url), { method: request.method }));
  const headers = new Headers(answer.headers);
  headers.set('Cache-Control', 'no-store');
  if (status === 503) headers.set('Retry-After', String(RETRY_SECONDS));
  return new Response(answer.body, { status, headers });
}

export async function respond(request: Request, world: DownloadWorld) {
  const channel = resolveChannel(new URL(request.url).pathname);
  if (!channel) return world.assets(request);
  const releases = await resolveCachedReleases(world);
  if (!releases) return respondWithPage(request, UNAVAILABLE_PAGE, 503, world);
  const asset = releases[channel];
  if (!asset && releases.beta) return respondWithPage(request, NO_STABLE_PAGE, 404, world);
  if (!asset) return respondWithPage(request, UNAVAILABLE_PAGE, 404, world);
  const download = await streamAsset(request, asset, world);
  return download ?? respondWithPage(request, UNAVAILABLE_PAGE, 503, world);
}
