import type { AwaySpan } from '@shinsa/core';
import type { AppUpdate, AppUpdateChannel } from '@shinsa/core/engine-api/schema';
import type { DesktopNotice } from '../notifications/schema.ts';

export const PAGE_ACTIONS = ['new-task', 'command-menu', 'whats-new'] as const;

export type PageAction = (typeof PAGE_ACTIONS)[number];

export type DesktopWindowState = 'window' | 'fullscreen';

export interface DesktopStart {
  version: string;
  protocol: number;
  update: AppUpdate;
  channel: AppUpdateChannel;
  windowState: DesktopWindowState;
}

export interface DesktopBridge extends DesktopStart {
  updateBadge: (count: number) => void;
  notify: (notice: DesktopNotice) => void;
  openNotificationSettings: () => void;
  onNotifyFailed: (listener: () => void) => () => void;
  installUpdate: () => void;
  checkForUpdates: () => void;
  applyUpdateChannel: (channel: AppUpdateChannel) => void;
  answerDowngrade: (accept: boolean) => void;
  onNavigate: (listener: (path: string) => void) => () => void;
  onWindowState: (listener: (state: DesktopWindowState) => void) => () => void;
  onUpdate: (listener: (update: AppUpdate) => void) => () => void;
  onAway: (listener: (span: AwaySpan) => void) => () => void;
  onAction: (listener: (action: PageAction) => void) => () => void;
}

export const CHANNELS = {
  start: 'shinsa:start',
  badge: 'shinsa:badge',
  notify: 'shinsa:notify',
  notifyFailed: 'shinsa:notify-failed',
  notificationSettings: 'shinsa:notification-settings',
  navigate: 'shinsa:navigate',
  windowState: 'shinsa:window-state',
  update: 'shinsa:update',
  installUpdate: 'shinsa:install-update',
  checkForUpdates: 'shinsa:check-for-updates',
  updateChannel: 'shinsa:update-channel',
  downgrade: 'shinsa:downgrade',
  away: 'shinsa:away',
  action: 'shinsa:action',
} as const;
