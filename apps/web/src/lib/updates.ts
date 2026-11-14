import { resolveEngineFit, resolveReleaseChannel } from '@shinsa/core';
import type { AppUpdateReport } from '@shinsa/core/engine-api/schema';
import type { IconName } from '@shinsa/ui/components/icon';
import type { AppUpdatesView } from '@/lib/connection/app-updates.ts';
import type { DesktopUpdate, UpdateChannel } from '@/lib/desktop.ts';
import type { Tone } from '@/lib/format/tone.ts';

export const UPDATES_SECTION = 'Updates';

export const UPDATES_LABEL = {
  check: 'Check for updates',
  app: 'Shinsa',
  channel: 'Update channel',
  restart: 'Restart to update',
  downgrade: 'Download and install',
  engine: 'Engine',
  open: 'Open Shinsa for Mac',
  restartEngine: 'Restart engine',
  reading: 'Reading the versions on that machine…',
  standalone: 'Installed with npm or the install script, so it updates on that machine.',
  outdated: 'Update Shinsa on that machine first to see and install its updates from here.',
  notRunning: 'Not running',
  notRunningDetail: 'Open it to check for updates and install them from here. Agents keep running.',
  installingDetail: 'Shinsa for Mac quits, installs and opens again. The engine follows on its own.',
  olderEngine: 'Older than the app',
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

export type MachineUpdates =
  | { kind: 'outdated' }
  | { kind: 'reading' }
  | { kind: 'failed'; message: string }
  | { kind: 'standalone'; engine: string }
  | { kind: 'not_running'; engine: string; app: string | null }
  | { kind: 'installing'; engine: string; app: string | null; version: string }
  | { kind: 'running'; engine: string; app: AppUpdateReport; restartEngine: boolean };

export function resolveMachineUpdates(view: AppUpdatesView, supported: boolean): MachineUpdates {
  if (!supported) return { kind: 'outdated' };
  const { answer } = view;
  if (!answer) return view.failure ? { kind: 'failed', message: view.failure } : { kind: 'reading' };
  const engine = answer.engine.version;
  if (answer.source === 'standalone') return { kind: 'standalone', engine };
  const app = answer.app;
  if (answer.running && app) {
    const restartEngine = resolveEngineFit(app, answer.engine).kind === 'restart_engine';
    return { kind: 'running', engine, app, restartEngine };
  }
  const version = app?.version ?? null;
  if (answer.installing) return { kind: 'installing', engine, app: version, version: answer.installing };
  return { kind: 'not_running', engine, app: version };
}

export function describeInstalling(version: string) {
  return `Installing ${version}…`;
}
