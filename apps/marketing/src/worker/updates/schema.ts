import { type Channel, KOE_DMG_NAME } from '../releases/schema.ts';

export interface UpdateFile {
  readonly key: string;
  readonly contentType: string;
  readonly cacheControl: string;
}

export const UPDATES_PATH = '/updates';

export const UPDATES_PREFIX = 'updates/';

export const KOE_APPCAST_PATH = '/koe/appcast';

export const KOE_RELEASES_PATH = '/koe/releases';

export const UPDATE_PATHS = [UPDATES_PATH, KOE_APPCAST_PATH, KOE_RELEASES_PATH];

export const KOE_APPCAST_FILES: readonly string[] = ['stable.xml', 'beta.xml', 'canary.xml'];

export const APPCAST_CONTENT_TYPE = 'application/xml; charset=utf-8';

export const KOE_BUILD_CONTENT_TYPES: Record<string, string> = {
  [KOE_DMG_NAME]: 'application/x-apple-diskimage',
};

export const ZIP_NAME = 'Shinsa-mac-arm64.zip';

export const BLOCKMAP_NAME = `${ZIP_NAME}.blockmap`;

export const UPDATE_CHANNEL_FILES: Record<Channel, string> = {
  stable: 'latest-mac.yml',
  beta: 'beta-mac.yml',
  canary: 'canary-mac.yml',
};

export const CHANNEL_FILE_CACHE = 'public, max-age=60';

export const BUILD_FILE_CACHE = 'public, max-age=31536000, immutable';

export const BUILD_CONTENT_TYPES: Record<string, string> = {
  [ZIP_NAME]: 'application/zip',
  [BLOCKMAP_NAME]: 'application/octet-stream',
};
