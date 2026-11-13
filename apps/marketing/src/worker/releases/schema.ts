import { type ReleaseChannel, resolveVersionOrder } from '@shinsa/core';
import { DateTime, Option, Schema } from 'effect';

export type Channel = ReleaseChannel;

export const Version = Schema.String.check(
  Schema.makeFilter((value) => Option.contains(resolveVersionOrder(value, value), 0))
);

export const DownloadPointer = Schema.Struct({
  version: Version,
  key: Schema.NonEmptyString,
  size: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  publishedAt: Schema.String.check(Schema.makeFilter((value) => Option.isSome(DateTime.make(value)))),
});
export type DownloadPointer = typeof DownloadPointer.Type;

export const FeedVersions = Schema.Array(Version);

export const DMG_NAME = 'Shinsa-mac-arm64.dmg';

export const KOE_DMG_NAME = 'Koe.dmg';

export interface Product {
  readonly name: 'shinsa' | 'koe';
  readonly downloadPath: string;
  readonly prefix: string;
  readonly dmgName: string;
  readonly fileStem: string;
  readonly comingSoonUrl: Option.Option<string>;
}

export const SHINSA: Product = {
  name: 'shinsa',
  downloadPath: '/download',
  prefix: '',
  dmgName: DMG_NAME,
  fileStem: 'Shinsa',
  comingSoonUrl: Option.none(),
};

export const KOE: Product = {
  name: 'koe',
  downloadPath: '/koe/download',
  prefix: 'koe/',
  dmgName: KOE_DMG_NAME,
  fileStem: 'Koe',
  comingSoonUrl: Option.some('/koe#soon'),
};

export const PRODUCTS: readonly Product[] = [SHINSA, KOE];

export const REPOSITORY_URL = 'https://github.com/shinsa-dev/shinsa';

export const RELEASES_PAGE = `${REPOSITORY_URL}/releases`;

export const RELEASES_FEED = `${REPOSITORY_URL}/releases.atom`;

export const LATEST_STABLE_URL = `${REPOSITORY_URL}/releases/latest/download/${DMG_NAME}`;

export const CACHE_ORIGIN = 'https://shinsa.dev/cache/download';

export const FEED_CACHE_KEY = `${CACHE_ORIGIN}/feed`;

export const FEED_HEADERS = { Accept: 'application/atom+xml', 'User-Agent': 'shinsa.dev' };

export const FEED_TAG_PATTERN = /\/releases\/tag\/([^"<>\s]+)"/g;

export const SERVED_CHANNELS: Record<Channel, readonly Channel[]> = {
  stable: ['stable', 'beta'],
  beta: ['stable', 'beta'],
  canary: ['canary'],
};
