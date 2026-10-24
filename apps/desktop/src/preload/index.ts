import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';
import { CHANNELS, type DesktopBridge, type DesktopStart, type DesktopWindowState } from '../lib/bridge.ts';

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
    windowState: start.windowState,
    updateBadge: (count) => ipcRenderer.send(CHANNELS.badge, count),
    notify: (notice) => ipcRenderer.send(CHANNELS.notify, notice),
    onNavigate: (listener) => subscribe<string>(CHANNELS.navigate, listener),
    onWindowState: (listener) => subscribe<DesktopWindowState>(CHANNELS.windowState, listener),
  };
  contextBridge.exposeInMainWorld('shinsaDesktop', bridge);
}
