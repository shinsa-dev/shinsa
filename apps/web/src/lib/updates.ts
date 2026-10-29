import { resolveReleaseChannel } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import type { DesktopUpdate, UpdateChannel } from '@/lib/desktop.ts';
import type { Tone } from '@/lib/format/tone.ts';

export const UPDATES_SECTION = 'Updates';

export const UPDATES_LABEL = {
  check: 'Check for updates',
  app: 'Shinsa',
  channel: 'Update channel',
  restart: 'Restart to update',
  downgrade: 'Download and install',
  browser: 'Shinsa for Mac updates itself. Its version and update channel are in its own Settings.',
  engine: 'Engine',
  agents:
    'Updating or quitting the app never stops your agents. After an update the engine restarts into the new version on its own, and agents pick up where they were.',
} as const;

export function describeUpdateHint(version: string) {
  return `Shinsa ${version} is ready. The app restarts, then the engine follows on its own and agents pick up where they were.`;
}

const CHANNEL_ITEM: Record<UpdateChannel, { value: UpdateChannel; label: string; icon: IconName }> = {
  stable: { value: 'stable', label: 'Stable', icon: 'IconShieldCheck' },
  beta: { value: 'beta', label: 'Beta', icon: 'IconTestTube' },
  canary: { value: 'canary', label: 'Canary', icon: 'IconFeather' },
};

export const UPDATE_CHANNEL_ITEMS = [CHANNEL_ITEM.stable, CHANNEL_ITEM.beta, CHANNEL_ITEM.canary];

const CHANNEL_DETAIL: Record<UpdateChannel, string> = {
  stable: 'Releases only. Coming from a beta or a canary, you can go back to the latest stable.',
  beta: 'New versions first, as pre-releases, and every stable release once it is newer than yours.',
  canary: 'Every merge into main once its tests pass. Less tested than Beta.',
};

export function parseUpdateChannel(value: string): UpdateChannel {
  return UPDATE_CHANNEL_ITEMS.find((item) => item.value === value)?.value ?? 'stable';
}

export function describeStayLabel(version: string) {
  return `Stay on this ${resolveReleaseChannel(version)}`;
}

export function describeChannelDetail(channel: UpdateChannel) {
  return CHANNEL_DETAIL[channel];
}

export function describeAppDetail(channel: UpdateChannel) {
  return `${CHANNEL_ITEM[channel].label} channel · Updates install when you quit ${UPDATES_LABEL.app}`;
}

export function describeUpdateStatus(update: DesktopUpdate): { label: string; tone: Tone } | null {
  switch (update.status) {
    case 'checking':
      return { label: 'Checking for updates…', tone: 'neutral' };
    case 'current':
      return { label: 'Up to date', tone: 'neutral' };
    case 'failed':
      return { label: update.message, tone: 'orange' };
    case 'downloading':
      return { label: `Downloading ${update.version}… ${update.percent}%`, tone: 'neutral' };
    case 'preparing':
      return { label: `Preparing ${update.version}…`, tone: 'neutral' };
    case 'ready':
      return { label: `${update.version} is ready`, tone: 'blue' };
    case 'installing':
      return { label: `Restarting to install ${update.version}…`, tone: 'neutral' };
    case 'downgrade':
      return {
        label: `Go back to ${update.version} (${resolveReleaseChannel(update.version)})?`,
        tone: 'blue',
      };
    case 'none':
      return null;
  }
}
