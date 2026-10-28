import { type AppFlavor, resolveReleaseChannel, resolveVersionOrder } from '@shinsa/core';
import type { UpdateChannel } from './bridge.ts';
import { FLAVOR } from './flavor.ts';

export const UPDATE_FEED = { provider: 'github', owner: 'shinsa-dev', repo: 'shinsa' } as const;

const CHANNEL_LABELS: Record<UpdateChannel, string> = { stable: 'Stable', beta: 'Beta', canary: 'Canary' };

const CHANNEL_RANKS: Record<UpdateChannel, number> = { stable: 0, beta: 1, canary: 2 };

const FLAVOR_CHANNELS: Record<AppFlavor, { channels: readonly UpdateChannel[]; nearest: UpdateChannel }> = {
  stable: { channels: ['stable', 'beta'], nearest: 'beta' },
  canary: { channels: ['canary'], nearest: 'canary' },
};

export function listUpdateChannels(flavor: AppFlavor = FLAVOR.flavor) {
  return FLAVOR_CHANNELS[flavor].channels;
}

export function parseUpdateChannel(value: unknown, flavor: AppFlavor = FLAVOR.flavor): UpdateChannel | null {
  return listUpdateChannels(flavor).find((channel) => channel === value) ?? null;
}

export function resolveUpdateChannel(
  stored: unknown,
  version: string,
  flavor: AppFlavor = FLAVOR.flavor
): UpdateChannel {
  return (
    parseUpdateChannel(stored, flavor) ??
    parseUpdateChannel(resolveReleaseChannel(version), flavor) ??
    FLAVOR_CHANNELS[flavor].nearest
  );
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
