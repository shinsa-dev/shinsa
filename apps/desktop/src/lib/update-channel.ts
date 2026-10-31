import { resolveReleaseChannel, resolveVersionOrder } from '@shinsa/core';
import type { UpdateChannel } from './bridge.ts';

export const UPDATE_FEED = {
  provider: 'generic',
  url: 'https://shinsa.dev/updates',
  useMultipleRangeRequest: false,
} as const;

const CHANNEL_LABELS: Record<UpdateChannel, string> = { stable: 'Stable', beta: 'Beta', canary: 'Canary' };

const CHANNEL_RANKS: Record<UpdateChannel, number> = { stable: 0, beta: 1, canary: 2 };

const UPDATE_CHANNELS: readonly UpdateChannel[] = ['stable', 'beta', 'canary'];

export function parseUpdateChannel(value: unknown): UpdateChannel | null {
  return UPDATE_CHANNELS.find((channel) => channel === value) ?? null;
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
