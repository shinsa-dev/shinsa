import type { AwaySpan } from '@shinsa/core';
import type { DesktopNotice } from '../notifications/schema.ts';
import type { UpdateChannel } from '../updates/schema.ts';

export const PAGE_ACTIONS = ['new-task', 'command-menu', 'whats-new'] as const;

export type PageAction = (typeof PAGE_ACTIONS)[number];

export type DesktopWindowState = 'window' | 'fullscreen';

export type DesktopUpdate =
  | { status: 'none' }
  | { status: 'checking' }
  | { status: 'current' }
  | { status: 'failed'; message: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'preparing'; version: string }
  | { status: 'ready'; version: string }
  | { status: 'installing'; version: string }
  | { status: 'downgrade'; version: string };

export interface DesktopStart {
  version: string;
  protocol: number;
  update: DesktopUpdate;
  channel: UpdateChannel;
  windowState: DesktopWindowState;
}

export interface DesktopBridge extends DesktopStart {
  updateBadge: (count: number) => void;
  notify: (notice: DesktopNotice) => void;
  openNotificationSettings: () => void;
  onNotifyFailed: (listener: () => void) => () => void;
  installUpdate: () => void;
  checkForUpdates: () => void;
  applyUpdateChannel: (channel: UpdateChannel) => void;
  answerDowngrade: (accept: boolean) => void;
  onNavigate: (listener: (path: string) => void) => () => void;
  onWindowState: (listener: (state: DesktopWindowState) => void) => () => void;
  onUpdate: (listener: (update: DesktopUpdate) => void) => () => void;
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
