export type Channel = 'stable' | 'beta';

type Identifier = string | number;

export interface Version {
  core: [number, number, number];
  prerelease: Identifier[];
}

interface Release {
  version: Version;
  url: string;
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

export const STABLE_URL = `https://github.com/shinsa-dev/shinsa/releases/latest/download/${DMG_NAME}`;

export const RELEASES_URL = 'https://github.com/shinsa-dev/shinsa/releases';

export const RELEASES_API = 'https://api.github.com/repos/shinsa-dev/shinsa/releases?per_page=10';

export const BETA_CACHE_KEY = 'https://shinsa.dev/cache/download/beta';

const BETA_CACHE_SECONDS = 300;

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

function selectDmgUrl(assets: unknown) {
  if (!Array.isArray(assets)) return null;
  for (const asset of assets) {
    if (!isRecord(asset) || asset.name !== DMG_NAME) continue;
    if (typeof asset.browser_download_url === 'string') return asset.browser_download_url;
  }
  return null;
}

function selectRelease(entry: unknown): Release | null {
  if (!isRecord(entry) || entry.draft !== false || typeof entry.tag_name !== 'string') return null;
  const version = parseVersion(entry.tag_name);
  const url = selectDmgUrl(entry.assets);
  if (!(version && url)) return null;
  return { version, url };
}

export function resolveBetaUrl(body: unknown) {
  if (!Array.isArray(body)) return null;
  let newest: Release | null = null;
  for (const entry of body) {
    const release = selectRelease(entry);
    if (release && (!newest || compareVersions(release.version, newest.version) > 0)) newest = release;
  }
  return newest?.url ?? null;
}

async function requestBetaUrl(world: DownloadWorld) {
  const response = await world.fetch(RELEASES_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'shinsa.dev',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) return null;
  return resolveBetaUrl(await response.json());
}

export async function resolveDownloadUrl(channel: Channel, world: DownloadWorld) {
  if (channel === 'stable') return STABLE_URL;
  try {
    const cached = await world.cache?.match(BETA_CACHE_KEY);
    if (cached) return await cached.text();
    const url = await requestBetaUrl(world);
    if (!url) return RELEASES_URL;
    await world.cache?.put(
      BETA_CACHE_KEY,
      new Response(url, { headers: { 'Cache-Control': `max-age=${BETA_CACHE_SECONDS}` } })
    );
    return url;
  } catch {
    return RELEASES_URL;
  }
}

export async function respond(request: Request, world: DownloadWorld) {
  const channel = resolveChannel(new URL(request.url).pathname);
  if (!channel) return world.assets(request);
  return Response.redirect(await resolveDownloadUrl(channel, world), 302);
}
