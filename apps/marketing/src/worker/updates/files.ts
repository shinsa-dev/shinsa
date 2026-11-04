import { Schema } from 'effect';
import { Version } from '../releases/schema.ts';
import {
  BUILD_CONTENT_TYPES,
  BUILD_FILE_CACHE,
  CHANNEL_FILE_CACHE,
  UPDATE_CHANNEL_FILES,
  type UpdateFile,
  UPDATES_PATH,
  UPDATES_PREFIX,
} from './schema.ts';

const isVersion = Schema.is(Version);

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
