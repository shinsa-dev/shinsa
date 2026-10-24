export type DesktopWindowState = 'window' | 'fullscreen';

export interface DesktopNotice {
  title: string;
  body: string;
  tag: string;
  path: string | null;
}

export interface DesktopStart {
  version: string;
  windowState: DesktopWindowState;
}

export interface DesktopBridge extends DesktopStart {
  updateBadge: (count: number) => void;
  notify: (notice: DesktopNotice) => void;
  onNavigate: (listener: (path: string) => void) => () => void;
  onWindowState: (listener: (state: DesktopWindowState) => void) => () => void;
}

export const CHANNELS = {
  start: 'shinsa:start',
  badge: 'shinsa:badge',
  notify: 'shinsa:notify',
  navigate: 'shinsa:navigate',
  windowState: 'shinsa:window-state',
} as const;
