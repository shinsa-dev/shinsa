import { resolveReleaseChannel, resolveVersionOrder } from '@shinsa/core';
import { AppUpdateChannel } from '@shinsa/core/engine-api/schema';
import { Option, Schema } from 'effect';
import { CHANNEL_LABELS, CHANNEL_RANKS } from './schema.ts';

const decodeUpdateChannel = Schema.decodeUnknownOption(AppUpdateChannel);

export function parseUpdateChannel(value: unknown): AppUpdateChannel | null {
  return Option.getOrNull(decodeUpdateChannel(value));
}

export function resolveUpdateChannel(stored: unknown, version: string): AppUpdateChannel {
  return parseUpdateChannel(stored) ?? resolveReleaseChannel(version);
}

export function isAboveChannel(version: string, channel: AppUpdateChannel) {
  return CHANNEL_RANKS[resolveReleaseChannel(version)] > CHANNEL_RANKS[channel];
}

export function resolveUpdaterOptions(channel: AppUpdateChannel, downgrade = false) {
  return {
    channel: channel === 'stable' ? 'latest' : channel,
    allowPrerelease: channel !== 'stable',
    allowDowngrade: downgrade && channel !== 'canary',
  };
}

export function resolveDowngradeOffer({
  channel,
  current,
  latest,
  kept,
}: {
  channel: AppUpdateChannel;
  current: string;
  latest: string;
  kept: string | null;
}) {
  if (kept === current || !isAboveChannel(current, channel)) return null;
  return Option.contains(resolveVersionOrder(latest, current), -1) ? latest : null;
}

export function describeUpdateChannel(channel: AppUpdateChannel) {
  return CHANNEL_LABELS[channel];
}

export function describeAppVersion(version: string, channel: AppUpdateChannel) {
  return `${version}, ${describeUpdateChannel(channel)} channel`;
}
