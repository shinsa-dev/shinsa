import { resolveReleaseChannel, resolveVersionOrder } from '@shinsa/core';
import type { DesktopUpdate, UpdateChannel } from './bridge.ts';
import { APP_NAME } from './dev-bundle.ts';
import { describeUpdateChannel, isAboveChannel } from './update-channel.ts';

export const UPDATE_CHECK_MS = 4 * 60 * 60 * 1000;

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking'; manual: boolean }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'current'; latest: string | null }
  | { status: 'downgrade'; version: string }
  | { status: 'failed'; message: string };

export interface UpdateMenuItem {
  label: string;
  enabled: boolean;
  install: boolean;
}

export function isUpdateSupported({ packaged, platform }: { packaged: boolean; platform: string }) {
  return packaged && platform === 'darwin';
}

export function describeUpdateItem(state: UpdateState): UpdateMenuItem {
  switch (state.status) {
    case 'checking':
      return { label: 'Checking for Updates…', enabled: false, install: false };
    case 'downloading':
      return {
        label: `Downloading ${APP_NAME} ${state.version}… ${Math.floor(state.percent)}%`,
        enabled: false,
        install: false,
      };
    case 'ready':
      return { label: `Restart to Update to ${state.version}`, enabled: true, install: true };
    default:
      return { label: 'Check for Updates…', enabled: true, install: false };
  }
}

export function describeReadyNotice(version: string) {
  return {
    title: `${APP_NAME} ${version} is ready`,
    body: `It installs the next time you quit ${APP_NAME}, or restart now from the ${APP_NAME} menu. Agents keep working either way.`,
  };
}

function describeCurrent(current: string, latest: string | null, channel: UpdateChannel) {
  const label = describeUpdateChannel(channel);
  if (latest && resolveVersionOrder(latest, current) === -1)
    return `You have ${APP_NAME} ${current}, newer than ${latest}, the latest on the ${label} channel. It stays on ${current} until the ${label} channel passes it.`;
  return `You have ${APP_NAME} ${current}, the latest version on the ${label} channel.`;
}

export function describeManualResult(state: UpdateState, current: string, channel: UpdateChannel) {
  switch (state.status) {
    case 'current':
      return {
        message: `${APP_NAME} is up to date`,
        detail: describeCurrent(current, state.latest, channel),
      };
    case 'failed':
      return { message: `${APP_NAME} could not check for updates`, detail: state.message };
    default:
      return null;
  }
}

export const DOWNGRADE_ACCEPT = 0;

export function describeDowngradeDialog(version: string, current: string, channel: UpdateChannel) {
  const kind = resolveReleaseChannel(current);
  const label = describeUpdateChannel(channel);
  return {
    message: `Go back to ${version} (${resolveReleaseChannel(version)})?`,
    detail: `You have the ${kind} ${current}, newer than ${version}, the latest on the ${label} channel. ${APP_NAME} can download ${version} and install it when you quit, like any update. Or stay on this ${kind} until the ${label} channel passes it.`,
    buttons: ['Download and install', `Stay on this ${kind}`],
    defaultId: DOWNGRADE_ACCEPT,
    cancelId: 1,
  };
}

export function needsDiscard(state: UpdateState, channel: UpdateChannel) {
  if (state.status !== 'downloading' && state.status !== 'ready') return false;
  return isAboveChannel(state.version, channel);
}

export function resolveStagedUpdate(home: string, appId: string) {
  const label = `${appId}.ShipIt`;
  return { label, directory: `${home}/Library/Caches/${label}` };
}

export function describeUpdateFailure(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  return firstLine || 'The update server did not answer. Try again later.';
}

export function resolveDesktopUpdate(state: UpdateState): DesktopUpdate {
  switch (state.status) {
    case 'checking':
      return { status: 'checking' };
    case 'current':
      return { status: 'current' };
    case 'failed':
      return { status: 'failed', message: state.message };
    case 'downloading':
      return { status: 'downloading', version: state.version };
    case 'ready':
      return { status: 'ready', version: state.version };
    case 'downgrade':
      return { status: 'downgrade', version: state.version };
    default:
      return { status: 'none' };
  }
}
