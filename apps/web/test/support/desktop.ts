import type { DesktopBridge, DesktopNotice } from '@/lib/desktop.ts';

type WindowState = DesktopBridge['windowState'];

export function installDesktop(windowState: WindowState = 'window') {
  const badges: number[] = [];
  const notices: DesktopNotice[] = [];
  const navigateListeners = new Set<(path: string) => void>();
  const stateListeners = new Set<(state: WindowState) => void>();
  const bridge: DesktopBridge = {
    version: '0.0.0',
    windowState,
    updateBadge: (count) => badges.push(count),
    notify: (notice) => notices.push(notice),
    onNavigate: (listener) => {
      navigateListeners.add(listener);
      return () => navigateListeners.delete(listener);
    },
    onWindowState: (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
  };
  window.shinsaDesktop = bridge;
  return {
    badges,
    notices,
    listeners: () => navigateListeners.size + stateListeners.size,
    navigate: (path: string) => {
      for (const listener of navigateListeners) listener(path);
    },
    changeWindowState: (state: WindowState) => {
      for (const listener of stateListeners) listener(state);
    },
    restore: () => {
      delete window.shinsaDesktop;
    },
  };
}
