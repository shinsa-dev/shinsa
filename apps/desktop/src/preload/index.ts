import type { AwaySpan } from '@shinsa/core';
import type { AppUpdate } from '@shinsa/core/engine-api/schema';
import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';
import {
  CHANNELS,
  type DesktopBridge,
  type DesktopStart,
  type DesktopWindowState,
  type PageAction,
} from '../bridge/schema.ts';

function subscribe<T>(channel: string, listener: (value: T) => void) {
  const handler = (_event: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.off(channel, handler);
  };
}

const start = ipcRenderer.sendSync(CHANNELS.start) as DesktopStart | null;

if (start) {
  const bridge: DesktopBridge = {
    version: start.version,
    protocol: start.protocol,
    update: start.update,
    channel: start.channel,
    windowState: start.windowState,
    source: start.source,
    updateBadge: (count) => ipcRenderer.send(CHANNELS.badge, count),
    notify: (notice) => ipcRenderer.send(CHANNELS.notify, notice),
    openNotificationSettings: () => ipcRenderer.send(CHANNELS.notificationSettings),
    onNotifyFailed: (listener) => subscribe<void>(CHANNELS.notifyFailed, () => listener()),
    installUpdate: () => ipcRenderer.send(CHANNELS.installUpdate),
    checkForUpdates: () => ipcRenderer.send(CHANNELS.checkForUpdates),
    applyUpdateChannel: (channel) => ipcRenderer.send(CHANNELS.updateChannel, channel),
    answerDowngrade: (accept) => ipcRenderer.send(CHANNELS.downgrade, accept),
    signIn: () => ipcRenderer.send(CHANNELS.signIn),
    useLocalEngine: () => ipcRenderer.send(CHANNELS.useLocalEngine),
    useMachine: (machine) => ipcRenderer.send(CHANNELS.useMachine, machine),
    onNavigate: (listener) => subscribe<string>(CHANNELS.navigate, listener),
    onWindowState: (listener) => subscribe<DesktopWindowState>(CHANNELS.windowState, listener),
    onUpdate: (listener) => subscribe<AppUpdate>(CHANNELS.update, listener),
    onAway: (listener) => subscribe<AwaySpan>(CHANNELS.away, listener),
    onAction: (listener) => subscribe<PageAction>(CHANNELS.action, listener),
  };
  contextBridge.exposeInMainWorld('shinsaDesktop', bridge);
}
