import { Schema } from 'effect';
import { Version } from '../releases/schema.ts';
import {
  APPCAST_CONTENT_TYPE,
  BUILD_CONTENT_TYPES,
  BUILD_FILE_CACHE,
  CHANNEL_FILE_CACHE,
  KOE_APPCAST_FILES,
  KOE_APPCAST_PATH,
  KOE_BUILD_CONTENT_TYPES,
  KOE_RELEASES_PATH,
  UPDATE_CHANNEL_FILES,
  type UpdateFile,
  UPDATE_PATHS,
  UPDATES_PATH,
  UPDATES_PREFIX,
} from './schema.ts';

const isVersion = Schema.is(Version);

function isUnder(pathname: string, root: string) {
  return pathname === root || pathname.startsWith(`${root}/`);
}

function listParts(pathname: string, root: string) {
  return pathname.slice(root.length + 1).split('/');
}

function resolveBuildFile(
  parts: readonly string[],
  contentTypes: Record<string, string>,
  resolveKey: (version: string, name: string) => string
): UpdateFile | null {
  const [version, name = '', ...rest] = parts;
  const contentType = contentTypes[name];
  if (rest.length > 0 || !isVersion(version) || !contentType) return null;
  return { key: resolveKey(version, name), contentType, cacheControl: BUILD_FILE_CACHE };
}

export function isUpdatePath(pathname: string) {
  return UPDATE_PATHS.some((root) => isUnder(pathname, root));
}

export function resolveUpdateKey(name: string) {
  return `${UPDATES_PREFIX}${name}`;
}

export function resolveBuildKey(version: string, name: string) {
  return `releases/${version}/${name}`;
}

function resolveKoeBuildKey(version: string, name: string) {
  return `koe/${resolveBuildKey(version, name)}`;
}

function resolveKoeAppcastKey(name: string) {
  return `koe/appcast/${name}`;
}

function resolveKoeAppcast(parts: readonly string[]): UpdateFile | null {
  const [name = '', ...rest] = parts;
  if (rest.length > 0 || !KOE_APPCAST_FILES.includes(name)) return null;
  return {
    key: resolveKoeAppcastKey(name),
    contentType: APPCAST_CONTENT_TYPE,
    cacheControl: CHANNEL_FILE_CACHE,
  };
}

function resolveShinsaUpdate(parts: readonly string[]): UpdateFile | null {
  if (parts.length === 1) {
    const [name = ''] = parts;
    if (!Object.values(UPDATE_CHANNEL_FILES).includes(name)) return null;
    return {
      key: resolveUpdateKey(name),
      contentType: 'text/yaml; charset=utf-8',
      cacheControl: CHANNEL_FILE_CACHE,
    };
  }
  return resolveBuildFile(parts, BUILD_CONTENT_TYPES, resolveBuildKey);
}

export function resolveUpdateFile(pathname: string): UpdateFile | null {
  if (isUnder(pathname, KOE_APPCAST_PATH)) return resolveKoeAppcast(listParts(pathname, KOE_APPCAST_PATH));
  if (isUnder(pathname, KOE_RELEASES_PATH))
    return resolveBuildFile(
      listParts(pathname, KOE_RELEASES_PATH),
      KOE_BUILD_CONTENT_TYPES,
      resolveKoeBuildKey
    );
  return resolveShinsaUpdate(listParts(pathname, UPDATES_PATH));
}
