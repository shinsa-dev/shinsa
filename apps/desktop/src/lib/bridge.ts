export type DesktopWindowState = 'window' | 'fullscreen';

export interface DesktopNotice {
  title: string;
  body: string;
  tag: string;
  path: string | null;
}

export type DesktopUpdate =
  | { status: 'none' }
  | { status: 'downloading'; version: string }
  | { status: 'ready'; version: string };

export interface DesktopStart {
  version: string;
  protocol: number;
  update: DesktopUpdate;
  windowState: DesktopWindowState;
}

export interface DesktopBridge extends DesktopStart {
  updateBadge: (count: number) => void;
  notify: (notice: DesktopNotice) => void;
  installUpdate: () => void;
  checkForUpdates: () => void;
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
} as const;
