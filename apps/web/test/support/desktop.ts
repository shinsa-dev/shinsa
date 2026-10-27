import type { DesktopBridge, DesktopNotice, DesktopUpdate, UpdateChannel } from '@/lib/desktop.ts';

type WindowState = DesktopBridge['windowState'];

export function installDesktop(windowState: WindowState = 'window') {
  const badges: number[] = [];
  const notices: DesktopNotice[] = [];
  const navigateListeners = new Set<(path: string) => void>();
  const stateListeners = new Set<(state: WindowState) => void>();
  const updateListeners = new Set<(update: DesktopUpdate) => void>();
  const updateCalls: string[] = [];
  const channels: UpdateChannel[] = [];
  const bridge: DesktopBridge = {
    version: '0.0.0',
    protocol: 1,
    update: { status: 'none' },
    channel: 'stable',
    windowState,
    updateBadge: (count) => badges.push(count),
    notify: (notice) => notices.push(notice),
    installUpdate: () => updateCalls.push('install'),
    checkForUpdates: () => updateCalls.push('check'),
    applyUpdateChannel: (channel) => channels.push(channel),
    answerDowngrade: (accept) => updateCalls.push(accept ? 'downgrade' : 'keep beta'),
    onUpdate: (listener) => {
      updateListeners.add(listener);
      return () => updateListeners.delete(listener);
    },
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
    bridge,
    badges,
    notices,
    updateCalls,
    channels,
    changeUpdate: (update: DesktopUpdate) => {
      for (const listener of updateListeners) listener(update);
    },
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
