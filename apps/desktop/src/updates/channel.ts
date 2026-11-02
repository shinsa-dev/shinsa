import { resolveReleaseChannel, resolveVersionOrder } from '@shinsa/core';
import { Option, Schema } from 'effect';
import { CHANNEL_LABELS, CHANNEL_RANKS, UpdateChannel } from './schema.ts';

const decodeUpdateChannel = Schema.decodeUnknownOption(UpdateChannel);

export function parseUpdateChannel(value: unknown): UpdateChannel | null {
  return Option.getOrNull(decodeUpdateChannel(value));
}

export function resolveUpdateChannel(stored: unknown, version: string): UpdateChannel {
  return parseUpdateChannel(stored) ?? resolveReleaseChannel(version);
}

export function isAboveChannel(version: string, channel: UpdateChannel) {
  return CHANNEL_RANKS[resolveReleaseChannel(version)] > CHANNEL_RANKS[channel];
}

export function resolveUpdaterOptions(channel: UpdateChannel, downgrade = false) {
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
  channel: UpdateChannel;
  current: string;
  latest: string;
  kept: string | null;
}) {
  if (kept === current || !isAboveChannel(current, channel)) return null;
  return resolveVersionOrder(latest, current) === -1 ? latest : null;
}

export function describeUpdateChannel(channel: UpdateChannel) {
  return CHANNEL_LABELS[channel];
}

export function describeAppVersion(version: string, channel: UpdateChannel) {
  return `${version}, ${describeUpdateChannel(channel)} channel`;
}
