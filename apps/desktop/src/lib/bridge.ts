export type DesktopWindowState = 'window' | 'fullscreen';

export interface DesktopNotice {
  title: string;
  body: string;
  tag: string;
  path: string | null;
}

export type UpdateChannel = 'stable' | 'beta';

export type DesktopUpdate =
  | { status: 'none' }
  | { status: 'checking' }
  | { status: 'current' }
  | { status: 'failed'; message: string }
  | { status: 'downloading'; version: string }
  | { status: 'ready'; version: string }
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
  installUpdate: () => void;
  checkForUpdates: () => void;
  applyUpdateChannel: (channel: UpdateChannel) => void;
  answerDowngrade: (accept: boolean) => void;
  onNavigate: (listener: (path: string) => void) => () => void;
  onWindowState: (listener: (state: DesktopWindowState) => void) => () => void;
  onUpdate: (listener: (update: DesktopUpdate) => void) => () => void;
}

export const CHANNELS = {
  start: 'shinsa:start',
  badge: 'shinsa:badge',
  notify: 'shinsa:notify',
  navigate: 'shinsa:navigate',
  windowState: 'shinsa:window-state',
  update: 'shinsa:update',
  installUpdate: 'shinsa:install-update',
  checkForUpdates: 'shinsa:check-for-updates',
  updateChannel: 'shinsa:update-channel',
  downgrade: 'shinsa:downgrade',
} as const;
