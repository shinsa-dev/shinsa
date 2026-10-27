import { isPrereleaseVersion, resolveVersionOrder } from '@shinsa/core';
import type { UpdateChannel } from './bridge.ts';

const CHANNEL_LABELS: Record<UpdateChannel, string> = { stable: 'Stable', beta: 'Beta' };

export function parseUpdateChannel(value: unknown): UpdateChannel | null {
  return value === 'stable' || value === 'beta' ? value : null;
}

export function resolveUpdateChannel(stored: unknown, version: string): UpdateChannel {
  return parseUpdateChannel(stored) ?? (isPrereleaseVersion(version) ? 'beta' : 'stable');
}

export function resolveUpdaterOptions(channel: UpdateChannel, downgrade = false) {
  return {
    channel: channel === 'beta' ? 'beta' : 'latest',
    allowPrerelease: channel === 'beta',
    allowDowngrade: downgrade && channel === 'stable',
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
  if (channel !== 'stable' || kept === current || !isPrereleaseVersion(current)) return null;
  return resolveVersionOrder(latest, current) === -1 ? latest : null;
}

export function describeUpdateChannel(channel: UpdateChannel) {
  return CHANNEL_LABELS[channel];
}

export function describeAppVersion(version: string, channel: UpdateChannel) {
  return `${version}, ${describeUpdateChannel(channel)} channel`;
}
