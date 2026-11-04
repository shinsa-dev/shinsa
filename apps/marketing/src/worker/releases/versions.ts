import { resolveReleaseChannel, resolveVersionOrder } from '@shinsa/core';
import { Schema } from 'effect';
import {
  type Channel,
  DMG_NAME,
  FEED_TAG_PATTERN,
  LATEST_STABLE_URL,
  RELEASES_PAGE,
  REPOSITORY_URL,
  SERVED_CHANNELS,
  Version,
} from './schema.ts';

const isVersion = Schema.is(Version);

function listServedVersions(tags: readonly string[], channel: Channel) {
  return tags.filter((tag) => SERVED_CHANNELS[channel].includes(resolveReleaseChannel(tag)));
}

function selectNewest(tags: readonly string[]) {
  return tags.reduce((newest, tag) => (resolveVersionOrder(tag, newest) === 1 ? tag : newest));
}

export function listFeedVersions(feed: string) {
  return Array.from(feed.matchAll(FEED_TAG_PATTERN), (match) => match[1]).filter(isVersion);
}

export function resolveFallbackUrl(tags: readonly string[], channel: Channel) {
  const released = tags.some((tag) => resolveReleaseChannel(tag) === 'stable');
  if (channel === 'stable' && (released || tags.length === 0)) return LATEST_STABLE_URL;
  const served = listServedVersions(tags, channel);
  if (served.length === 0) return channel === 'stable' ? LATEST_STABLE_URL : RELEASES_PAGE;
  return `${REPOSITORY_URL}/releases/download/${selectNewest(served)}/${DMG_NAME}`;
}

export function selectChannelVersion(tags: readonly string[], channel: Channel) {
  const served = listServedVersions(tags, channel);
  const stable = served.filter((tag) => resolveReleaseChannel(tag) === 'stable');
  const candidates = channel === 'stable' && stable.length > 0 ? stable : served;
  if (candidates.length === 0) return null;
  return selectNewest(candidates).replace(/^v/, '');
}
