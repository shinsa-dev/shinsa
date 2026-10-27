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
  keepBeta: 'Stay on this beta',
  browser: 'Shinsa for Mac updates itself. Its version and update channel are in its own Settings.',
} as const;

export const UPDATE_CHANNEL_ITEMS: { value: UpdateChannel; label: string; icon: IconName }[] = [
  { value: 'stable', label: 'Stable', icon: 'IconShieldCheck' },
  { value: 'beta', label: 'Beta', icon: 'IconTestTube' },
];

const CHANNEL_DETAIL: Record<UpdateChannel, string> = {
  stable: 'Releases only. Coming from a beta, you can go back to the latest stable.',
  beta: 'New versions first, as pre-releases, and every stable release once it is newer than yours.',
};

export function describeChannelDetail(channel: UpdateChannel) {
  return CHANNEL_DETAIL[channel];
}

export function describeAppDetail(channel: UpdateChannel, update: DesktopUpdate) {
  if (update.status === 'unavailable') return 'Install a release from shinsa.dev/download to get updates';
  const label = UPDATE_CHANNEL_ITEMS.find((item) => item.value === channel)?.label ?? channel;
  return `${label} channel · Updates install when you quit Shinsa`;
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
      return { label: `Downloading ${update.version}…`, tone: 'neutral' };
    case 'ready':
      return { label: `${update.version} is ready`, tone: 'blue' };
    case 'downgrade':
      return { label: `Go back to ${update.version} (stable)?`, tone: 'blue' };
    case 'unavailable':
      return { label: 'This build does not update itself', tone: 'neutral' };
    case 'none':
      return null;
  }
}
